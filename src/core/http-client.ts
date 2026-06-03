import type { SyncResponse } from "./canonical.js";

const RETRYABLE_STATUS = [429, 500, 502, 503, 504];
const RETRY_DELAYS_MS = [100, 200, 400];

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function post(
  url: string,
  body: unknown,
  token: string,
): Promise<SyncResponse> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const json: unknown = await response.json();
        return json as SyncResponse;
      }

      // 4xx — do not retry
      if (response.status >= 400 && response.status < 500) {
        throw new HttpError(response.status, `HTTP ${response.status}: ${response.statusText}`);
      }

      // 5xx — retry
      if (RETRYABLE_STATUS.includes(response.status)) {
        lastError = new HttpError(response.status, `HTTP ${response.status}: ${response.statusText}`);
        if (attempt < RETRY_DELAYS_MS.length) {
          await delay(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        throw lastError;
      }

      throw new HttpError(response.status, `HTTP ${response.status}: ${response.statusText}`);
    } catch (err) {
      if (err instanceof HttpError) {
        // 4xx — propagate immediately, no retry
        if (err.status >= 400 && err.status < 500) throw err;
        lastError = err;
      } else {
        // Network error — retry
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        await delay(RETRY_DELAYS_MS[attempt]!);
      }
    }
  }

  throw lastError ?? new Error("Unknown error in http-client");
}
