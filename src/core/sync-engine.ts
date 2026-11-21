import type { SessionWithMessages } from "./canonical.js";
import type { Adapter } from "../adapters/adapter.js";
import type { CursorStore } from "./cursor-store.js";
import { post } from "./http-client.js";
import { redactSession } from "./redact.js";
import { lastActivity } from "./since.js";
import { annotateSession } from "./injected.js";

export interface SyncConfig {
  syncUrl: string;
  deviceId: string;
  collectorVersion: string;
  deviceToken: string;
  batchSize?: number;
}

export interface SyncSummary {
  synced: number;
  failed: number;
  errors: string[];
}

export interface RunSyncOptions {
  /**
   * Send every session whose last activity is on or after this date, ignoring the saved cursor, and leave the
   * cursor as it is. A one-shot re-send, not a new baseline.
   */
  since?: Date;
}

export async function runSync(
  adapters: Adapter[],
  config: SyncConfig,
  cursorStore: CursorStore,
  httpPost: typeof post = post,
  options: RunSyncOptions = {},
): Promise<SyncSummary> {
  const since = options.since;
  const batchSize = config.batchSize ?? 5;

  // Every session is redacted here, the single choke point all uploads share
  // (CLI sync, daemon, MCP `sync_now`). AOM_NO_REDACT=1 is a debugging escape
  // hatch; it is loud on purpose.
  const redact = process.env["AOM_NO_REDACT"] !== "1";
  if (!redact) {
    console.error("[aom] WARNING: AOM_NO_REDACT=1 — secrets are NOT being removed before upload.");
  }

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const adapter of adapters) {
    const cursorValue = since === undefined ? cursorStore.get(adapter.name) : null;
    const cursor = { value: cursorValue };

    const batch: SessionWithMessages[] = [];
    let pendingCursor: string | null = null;

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      try {
        const body = {
          deviceId: config.deviceId,
          collectorVersion: config.collectorVersion,
          sentAt: new Date().toISOString(),
          sessions: batch.map((s) => (redact ? redactSession(annotateSession(s)) : annotateSession(s))),
        };
        const response = await httpPost(config.syncUrl, body, config.deviceToken);
        synced += response.accepted.length;
        failed += response.rejected.length;
        for (const r of response.rejected) {
          errors.push(`${adapter.name}/${r.sessionId}: ${r.reason}`);
        }
        if (pendingCursor !== null && since === undefined) {
          cursorStore.set(adapter.name, pendingCursor);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${adapter.name} batch error: ${msg}`);
        failed += batch.length;
      }
      batch.length = 0;
    };

    try {
      for await (const { session, cursor: itemCursor } of adapter.listNewSessions(cursor)) {
        if (since !== undefined) {
          const last = lastActivity(session);
          // A session with no readable date is sent, not dropped: losing one silently is worse than sending one more.
          if (last !== null && last.getTime() < since.getTime()) continue;
        }
        batch.push(session);
        pendingCursor = itemCursor;

        if (batch.length >= batchSize) {
          await flush();
        }
      }
      await flush();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${adapter.name} iteration error: ${msg}`);
    }
  }

  return { synced, failed, errors };
}
