/**
 * SyncRunner — debounced, single-flight wrapper around `performSync()`.
 *
 * File watchers and the MCP server fire many events in quick bursts (a single
 * agent session writes many rows/lines). Running a full sync per event would
 * hammer the backend. SyncRunner solves that:
 *
 *  - **Debounce:** `trigger()` schedules a sync after a quiet window
 *    (`debounceMs`). Each new trigger inside the window resets the timer, so a
 *    burst of N events collapses into one sync.
 *  - **Single-flight:** never runs two syncs at once. If `trigger()` arrives
 *    while a sync is in flight, exactly one follow-up sync is queued to run
 *    after the current one finishes (further triggers coalesce into that same
 *    follow-up).
 *
 * The runner is provider-agnostic — it just calls `performSync()`, which
 * itself drives all adapters since the last cursor. Any watcher can share one
 * SyncRunner instance.
 */

import type { SyncSummary } from "../core/sync-engine.js";
import { performSync, NotPairedError } from "../core/perform-sync.js";

export interface SyncRunnerOptions {
  /** Quiet window before a triggered sync runs. Default 5000ms. */
  debounceMs?: number;
  /** Log callback (wired to DaemonState.log). */
  log?: (msg: string) => void;
  /** Injectable sync function — defaults to the real `performSync`. For tests. */
  syncFn?: () => Promise<SyncSummary>;
  /** Called after each completed sync with its summary. */
  onSynced?: (summary: SyncSummary) => void;
}

export class SyncRunner {
  private readonly debounceMs: number;
  private readonly log: (msg: string) => void;
  private readonly syncFn: () => Promise<SyncSummary>;
  private readonly onSynced: ((summary: SyncSummary) => void) | undefined;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** A trigger arrived while a sync was in flight — run once more after. */
  private rerunQueued = false;

  constructor(opts: SyncRunnerOptions = {}) {
    this.debounceMs = opts.debounceMs ?? 5000;
    this.log = opts.log ?? (() => {});
    this.syncFn = opts.syncFn ?? performSync;
    this.onSynced = opts.onSynced;
  }

  /**
   * Request a sync. Coalesces with any pending debounce window and with an
   * in-flight sync (single-flight). Returns immediately; the sync runs async.
   */
  trigger(reason: string): void {
    this.log(`sync trigger: ${reason}`);

    if (this.running) {
      // A sync is in flight — guarantee one more pass after it completes so
      // changes that landed mid-sync are not missed.
      this.rerunQueued = true;
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.debounceMs);
  }

  /** Run a sync immediately (bypasses debounce). Still single-flight. */
  async runNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.run();
  }

  /** Cancel any pending debounced sync. In-flight syncs are not interrupted. */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.rerunQueued = true;
      return;
    }
    this.running = true;
    try {
      const summary = await this.syncFn();
      this.log(`sync done: synced=${summary.synced} failed=${summary.failed}`);
      if (summary.errors.length > 0) {
        this.log(`sync errors: ${summary.errors.slice(0, 3).join("; ")}`);
      }
      this.onSynced?.(summary);
    } catch (err) {
      if (err instanceof NotPairedError) {
        this.log("sync skipped: not paired");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`sync error: ${msg}`);
      }
    } finally {
      this.running = false;
    }

    // A trigger arrived while we were syncing — run exactly one more pass.
    if (this.rerunQueued) {
      this.rerunQueued = false;
      await this.run();
    }
  }
}
