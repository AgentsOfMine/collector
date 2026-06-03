import { describe, it, expect, vi, beforeEach } from "vitest";
import { post, HttpError } from "../../src/core/http-client.js";

const mockSyncResponse = {
  accepted: ["sess-001"],
  rejected: [],
};

describe("http-client post()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed body on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockSyncResponse,
      }),
    );

    const result = await post("https://api.test/sync", { sessions: [] }, "token-abc");
    expect(result.accepted).toEqual(["sess-001"]);
    expect(result.rejected).toEqual([]);
  });

  it("retries on 500 and succeeds on retry", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls++;
        if (calls < 3) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockSyncResponse,
        });
      }),
    );

    const result = await post("https://api.test/sync", {}, "token");
    expect(calls).toBe(3);
    expect(result.accepted).toEqual(["sess-001"]);
  });

  it("throws HttpError on 400 without retry", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls++;
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: "Bad Request",
        });
      }),
    );

    await expect(post("https://api.test/sync", {}, "token")).rejects.toThrow(HttpError);
    expect(calls).toBe(1); // no retries on 4xx
  });

  it("throws HttpError on 401 without retry", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls++;
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        });
      }),
    );

    await expect(post("https://api.test/sync", {}, "token")).rejects.toThrow(HttpError);
    expect(calls).toBe(1);
  });

  it("throws after exhausting all retries on 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    await expect(post("https://api.test/sync", {}, "token")).rejects.toThrow();
  });

  it("retries on network error", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls++;
        if (calls < 2) {
          return Promise.reject(new TypeError("fetch failed"));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockSyncResponse,
        });
      }),
    );

    const result = await post("https://api.test/sync", {}, "token");
    expect(calls).toBe(2);
    expect(result.accepted).toEqual(["sess-001"]);
  });

  it("sends Authorization Bearer header", async () => {
    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        capturedHeaders = options.headers;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockSyncResponse,
        });
      }),
    );

    await post("https://api.test/sync", {}, "my-secret-token");
    expect(capturedHeaders).toBeDefined();
    const headers = capturedHeaders as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-secret-token");
  });
});
