import type { SyncSummary } from "../core/sync-engine.js";

let lastSyncSummary: SyncSummary | null = null;
let lastSyncTime: string | null = null;

export function setLastSyncResult(summary: SyncSummary): void {
  lastSyncSummary = summary;
  lastSyncTime = new Date().toISOString();
}

export function getStatusPayload(): {
  lastSyncAt: string | null;
  synced: number;
  failed: number;
  errors: string[];
} {
  return {
    lastSyncAt: lastSyncTime,
    synced: lastSyncSummary?.synced ?? 0,
    failed: lastSyncSummary?.failed ?? 0,
    errors: lastSyncSummary?.errors ?? [],
  };
}
