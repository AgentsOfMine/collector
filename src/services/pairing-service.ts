/**
 * PairingService — orchestrates the full device-pairing flow.
 *
 * Responsibilities:
 *   1. Persist/read the device ID via ConfigRepository.
 *   2. Call PairingClient.initPairing() and PairingClient.pollStatus().
 *   3. Store the received device token via the keychain module.
 *   4. Persist the full PairingConfig on success.
 *
 * Terminal rendering (QR code, spinner, status messages) intentionally stays
 * in src/cli/pair.ts — this class only handles orchestration and I/O.
 */

import { randomUUID } from "node:crypto";
import { PairingClient, PairingApiError } from "../api/pairing-client.js";
import type { ConfigRepository } from "../infrastructure/config-repository.js";
import { storeDeviceToken } from "../keychain/index.js";


export interface PairFlowOptions {
  /**
   * If true, clear existing pairing config before starting.
   * Caller (cli/pair.ts) gates on `--force` / `--reset`.
   */
  reset?: boolean;
  /**
   * Called after init succeeds with the pairing code + QR URL + expiry.
   * Use this to render the terminal UI.
   */
  onInitSuccess: (params: {
    pairingCode: string;
    qrUrl: string;
    expiresInMinutes: number;
    pollIntervalMs: number;
  }) => void;
  /**
   * Called on each poll tick (before the HTTP request).
   * Use this to animate a spinner or progress indicator.
   */
  onPollTick?: (tick: number) => void;
}

export type PairFlowResult =
  | { status: "approved"; deviceId: string }
  | { status: "denied" }
  | { status: "expired" };


export class PairingService {
  constructor(
    private readonly client: PairingClient,
    private readonly configRepo: ConfigRepository,
  ) {}

  /**
   * Run the full pairing flow from init → poll → store.
   *
   * Does NOT call process.exit() — throws or returns PairFlowResult.
   * The caller (cli/pair.ts) decides how to surface errors to the user.
   */
  async runPairFlow(opts: PairFlowOptions): Promise<PairFlowResult> {
    if (opts.reset) {
      this.configRepo.clearPairingConfig();
    }

    const deviceId = this.getOrCreateDeviceId();

    // Step 1 — POST /pair/init
    const initResp = await this.client.initPairing(deviceId);

    const expiresInMinutes = Math.max(
      1,
      Math.round((initResp.expiresAt - Date.now() / 1000) / 60),
    );
    const pollIntervalMs = initResp.pollInterval * 1000;

    opts.onInitSuccess({
      pairingCode: initResp.pairingCode,
      qrUrl: initResp.qrUrl,
      expiresInMinutes,
      pollIntervalMs,
    });

    // Step 2 — Poll until resolved
    let tick = 0;
     
    while (true) {
      await sleep(pollIntervalMs);
      opts.onPollTick?.(tick++);

      let statusResp: Awaited<ReturnType<typeof this.client.pollStatus>>;
      try {
        statusResp = await this.client.pollStatus(deviceId);
      } catch (err) {
        if (err instanceof PairingApiError && err.statusCode >= 500) {
          // Transient server error — keep polling
          continue;
        }
        throw err;
      }

      switch (statusResp.status) {
        case "pending":
          continue;

        case "approved": {
          if (!statusResp.deviceToken) {
            throw new Error("Server returned approved but no deviceToken");
          }
          // Store token in keychain
          await storeDeviceToken(statusResp.deviceToken);
          // Persist full pairing config to disk
          this.configRepo.writePairingConfig({
            deviceId,
            deviceToken: statusResp.deviceToken,
            pairedAt: new Date().toISOString(),
          });
          return { status: "approved", deviceId };
        }

        case "denied":
          return { status: "denied" };

        case "expired":
          return { status: "expired" };

        default:
          // Unknown status — keep polling conservatively
          continue;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getOrCreateDeviceId(): string {
    const existing = this.configRepo.readDeviceId();
    if (existing) return existing;

    const id = randomUUID();
    this.configRepo.writeDeviceId(id);
    return id;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
