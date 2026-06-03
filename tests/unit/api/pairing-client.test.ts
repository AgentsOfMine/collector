import { describe, it, expect, vi, beforeEach } from "vitest";
import { PairingClient, PairingApiError } from "../../../src/api/pairing-client.ts";

// Mock node-fetch
vi.mock("node-fetch", () => ({
  default: vi.fn(),
}));

import { default as fetchMock } from "node-fetch";
const fetch = vi.mocked(fetchMock);

function makeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("PairingClient", () => {
  let client: PairingClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new PairingClient("https://test.agentsofmine.io");
  });

  describe("initPairing", () => {
    it("returns PairInitResponse on 201", async () => {
      const expected = {
        pairingCode: "AB3XKJ2P",
        expiresAt: 9999999999,
        pollInterval: 4,
        qrUrl: "https://test.agentsofmine.io/pair?code=AB3XKJ2P&device=test-id",
      };
      fetch.mockResolvedValueOnce(makeResponse(201, expected) as never);

      const result = await client.initPairing("test-device-id");

      expect(result).toEqual(expected);
      expect(fetch).toHaveBeenCalledWith(
        "https://test.agentsofmine.io/pair/init",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("throws PairingApiError on 400", async () => {
      fetch.mockResolvedValueOnce(makeResponse(400, { error: "invalid_device_id" }) as never);

      await expect(client.initPairing("bad-id")).rejects.toMatchObject({
        name: "PairingApiError",
        statusCode: 400,
      });
    });

    it("throws PairingApiError on 500", async () => {
      fetch.mockResolvedValueOnce(makeResponse(500, { error: "internal_error" }) as never);

      await expect(client.initPairing("test-id")).rejects.toMatchObject({
        statusCode: 500,
      });
    });

    it("sends userAgent in request body", async () => {
      fetch.mockResolvedValueOnce(
        makeResponse(201, {
          pairingCode: "X",
          expiresAt: 1,
          pollInterval: 4,
          qrUrl: "https://x",
        }) as never,
      );

      await client.initPairing("test-id");

      const call = fetch.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { userAgent: string };
      expect(body.userAgent).toContain("agentsofmine-collector");
      expect(body.deviceId).toBe("test-id");
    });
  });

  describe("pollStatus", () => {
    it("returns pending status", async () => {
      fetch.mockResolvedValueOnce(makeResponse(200, { status: "pending" }) as never);
      const result = await client.pollStatus("test-id");
      expect(result.status).toBe("pending");
    });

    it("returns approved status with deviceToken", async () => {
      fetch.mockResolvedValueOnce(
        makeResponse(200, { status: "approved", deviceToken: "tok-abc123" }) as never,
      );
      const result = await client.pollStatus("test-id");
      expect(result.status).toBe("approved");
      expect(result.deviceToken).toBe("tok-abc123");
    });

    it("returns denied status", async () => {
      fetch.mockResolvedValueOnce(makeResponse(200, { status: "denied" }) as never);
      const result = await client.pollStatus("test-id");
      expect(result.status).toBe("denied");
    });

    it("throws PairingApiError on 404", async () => {
      fetch.mockResolvedValueOnce(makeResponse(404, { error: "not_found" }) as never);
      await expect(client.pollStatus("gone-id")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("uses correct URL with encoded deviceId", async () => {
      fetch.mockResolvedValueOnce(makeResponse(200, { status: "pending" }) as never);
      await client.pollStatus("my device id");
      expect(fetch).toHaveBeenCalledWith(
        "https://test.agentsofmine.io/pair/status?device=my%20device%20id",
        { method: "GET" },
      );
    });
  });
});
