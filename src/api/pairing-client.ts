/**
 * Typed HTTP client for the AgentsOfMine Pairing API.
 *
 * Covers the two endpoints used by `aom pair`:
 *   POST /pair/init   — register a deviceId, receive a pairingCode + qrUrl
 *   GET  /pair/status — poll until the user approves on their phone
 *
 * Base URL defaults to https://agentsofmine.io but can be overridden via
 * the AOM_API_BASE_URL env var for development / staging.
 */

import { platform, hostname } from "node:os";
import { createRequire } from "node:module";


export interface PairInitRequest {
  deviceId: string;
  /** Human-readable OS hint. E.g. "agentsofmine-collector 0.1.0 / darwin-arm64 / hostname" */
  userAgent: string;
}

export interface PairInitResponse {
  pairingCode: string;
  expiresAt: number; // unix seconds
  pollInterval: number; // seconds
  qrUrl: string;
}

export type PairingStatus = "pending" | "approved" | "denied" | "expired";

export interface PairStatusResponse {
  status: PairingStatus;
  /** Present only when status === "approved" */
  deviceToken?: string;
}

export class PairingApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "PairingApiError";
  }
}


const DEFAULT_BASE_URL = "https://agentsofmine.io";

export class PairingClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ??
      process.env["AOM_API_BASE_URL"] ??
      DEFAULT_BASE_URL;
  }

  /** POST /pair/init — register deviceId and receive pairing code + QR URL */
  async initPairing(deviceId: string): Promise<PairInitResponse> {
    const body: PairInitRequest = {
      deviceId,
      userAgent: buildUserAgent(),
    };

    const res = await fetch(`${this.baseUrl}/pair/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (!res.ok) {
      throw new PairingApiError(
        `POST /pair/init failed: ${res.status}`,
        res.status,
        text,
      );
    }

    return JSON.parse(text) as PairInitResponse;
  }

  /** GET /pair/status?device=<deviceId> — check whether the user has approved */
  async pollStatus(deviceId: string): Promise<PairStatusResponse> {
    const url = `${this.baseUrl}/pair/status?device=${encodeURIComponent(deviceId)}`;
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();

    if (!res.ok) {
      throw new PairingApiError(
        `GET /pair/status failed: ${res.status}`,
        res.status,
        text,
      );
    }

    return JSON.parse(text) as PairStatusResponse;
  }
}


function buildUserAgent(): string {
  const pkg = getPackageVersion();
  const os = `${platform()}-${process.arch}`;
  const host = hostname();
  return `agentsofmine-collector ${pkg} / ${os} / ${host}`;
}

function getPackageVersion(): string {
  try {
    // Resolve package.json relative to this file at runtime
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}
