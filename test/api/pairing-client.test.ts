import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PairingClient } from "../../src/api/pairing-client.js";

// PairingClient uses the Node >=20 global fetch (no node-fetch dependency).
// We stub globalThis.fetch per-test and restore it afterwards.
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

function makeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("PairingClient", () => {
  let client: PairingClient;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    client = new PairingClient("https://test.agentsofmine.io");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("initPairing", () => {
    it("returns PairInitResponse on 201", async () => {
      const expected = {
        pairingCode: "AB3XKJ2P",
        expiresAt: 9999999999,
        pollInterval: 4,
        qrUrl: "https://test.agentsofmine.io/pair?code=AB3XKJ2P&device=test-id",
      };
      fetchMock.mockResolvedValueOnce(makeResponse(201, expected));

      const result = await client.initPairing("test-device-id");

      expect(result).toEqual(expected);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.agentsofmine.io/pair/init",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("throws PairingApiError on 400", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(400, { error: "invalid_device_id" }));

      await expect(client.initPairing("bad-id")).rejects.toMatchObject({
        name: "PairingApiError",
        statusCode: 400,
      });
    });

    it("throws PairingApiError on 500", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(500, { error: "internal_error" }));

      await expect(client.initPairing("test-id")).rejects.toMatchObject({
        statusCode: 500,
      });
    });

    it("sends userAgent and deviceId in request body", async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(201, {
          pairingCode: "X",
          expiresAt: 1,
          pollInterval: 4,
          qrUrl: "https://x",
        }),
      );

      await client.initPairing("test-id");

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as {
        userAgent: string;
        deviceId: string;
      };
      expect(body.userAgent).toContain("agentsofmine-collector");
      expect(body.deviceId).toBe("test-id");
    });
  });

  describe("pollStatus", () => {
    it("returns pending status", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(200, { status: "pending" }));
      const result = await client.pollStatus("test-id");
      expect(result.status).toBe("pending");
    });

    it("returns approved status with deviceToken", async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse(200, { status: "approved", deviceToken: "tok-abc123" }),
      );
      const result = await client.pollStatus("test-id");
      expect(result.status).toBe("approved");
      expect(result.deviceToken).toBe("tok-abc123");
    });

    it("returns denied status", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(200, { status: "denied" }));
      const result = await client.pollStatus("test-id");
      expect(result.status).toBe("denied");
    });

    it("throws PairingApiError on 404", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(404, { error: "not_found" }));
      await expect(client.pollStatus("gone-id")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("uses correct URL with encoded deviceId", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse(200, { status: "pending" }));
      await client.pollStatus("my device id");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://test.agentsofmine.io/pair/status?device=my%20device%20id",
        { method: "GET" },
      );
    });
  });
});
