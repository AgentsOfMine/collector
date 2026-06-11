import type { SessionWithMessages } from "./canonical.js";
import type { Adapter } from "../adapters/adapter.js";
import type { CursorStore } from "./cursor-store.js";
import { post } from "./http-client.js";

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

export async function runSync(
  adapters: Adapter[],
  config: SyncConfig,
  cursorStore: CursorStore,
  httpPost: typeof post = post,
): Promise<SyncSummary> {
  const batchSize = config.batchSize ?? 5;

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const adapter of adapters) {
    const cursorValue = cursorStore.get(adapter.name);
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
          sessions: [...batch],
        };
        const response = await httpPost(config.syncUrl, body, config.deviceToken);
        synced += response.accepted.length;
        failed += response.rejected.length;
        for (const r of response.rejected) {
          errors.push(`${adapter.name}/${r.sessionId}: ${r.reason}`);
        }
        if (pendingCursor !== null) {
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
