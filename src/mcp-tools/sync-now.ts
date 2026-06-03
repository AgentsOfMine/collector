import type { Adapter } from "../adapters/adapter.js";
import type { SyncConfig } from "../core/sync-engine.js";
import type { CursorStore } from "../core/cursor-store.js";
import { runSync } from "../core/sync-engine.js";
import { setLastSyncResult } from "./status.js";

export async function syncNow(
  adapters: Adapter[],
  config: SyncConfig,
  cursorStore: CursorStore,
): Promise<{ synced: number; failed: number; errors: string[] }> {
  const summary = await runSync(adapters, config, cursorStore);
  setLastSyncResult(summary);
  return summary;
}
