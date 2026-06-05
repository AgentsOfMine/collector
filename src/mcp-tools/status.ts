import type { SyncSummary } from "../core/sync-engine.js";

export interface SyncStatus {
  lastSyncAt: string | null;
  synced: number;
  failed: number;
  errors: string[];
}

export class SyncStatusStore {
  private lastSummary: SyncSummary | null = null;
  private lastSyncAt: string | null = null;

  record(summary: SyncSummary): void {
    this.lastSummary = summary;
    this.lastSyncAt = new Date().toISOString();
  }

  get(): SyncStatus {
    return {
      lastSyncAt: this.lastSyncAt,
      synced: this.lastSummary?.synced ?? 0,
      failed: this.lastSummary?.failed ?? 0,
      errors: this.lastSummary?.errors ?? [],
    };
  }
}

export const syncStatusStore = new SyncStatusStore();

export function setLastSyncResult(summary: SyncSummary): void {
  syncStatusStore.record(summary);
}

export function getStatusPayload(): SyncStatus {
  return syncStatusStore.get();
}
