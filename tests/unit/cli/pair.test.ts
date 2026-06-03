import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock keytar
vi.mock("keytar", () => ({
  default: {
    setPassword: vi.fn(),
    getPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
}));

// Mock node-fetch
vi.mock("node-fetch", () => ({ default: vi.fn() }));

// Mock open (browser)
vi.mock("open", () => ({ default: vi.fn() }));

// Mock qrcode-terminal
vi.mock("qrcode-terminal", () => ({ default: { generate: vi.fn() } }));

import keytar from "keytar";
const keytarMock = vi.mocked(keytar);

import { default as fetchMock } from "node-fetch";
const fetch = vi.mocked(fetchMock);

function mockResponse(status: number, body: unknown) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) };
}

describe("runPair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exits early with message if already paired and --force not set", async () => {
    keytarMock.getPassword.mockResolvedValue("existing-token");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { runPair } = await import("../../../src/cli/pair.ts");
    await runPair({ noBrowser: true });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("already paired"),
    );
    expect(fetch).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("calls /pair/init and stores token on approval", async () => {
    // Not paired
    keytarMock.getPassword.mockResolvedValueOnce(null);
    // /pair/init
    fetch.mockResolvedValueOnce(
      mockResponse(201, {
        pairingCode: "AB3XKJ2P",
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        pollInterval: 0, // instant for test
        qrUrl: "https://agentsofmine.io/pair?code=AB3XKJ2P&device=test-id",
      }) as never,
    );
    // /pair/status → approved immediately
    fetch.mockResolvedValueOnce(
      mockResponse(200, { status: "approved", deviceToken: "device-tok-xyz" }) as never,
    );
    keytarMock.setPassword.mockResolvedValue(undefined);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const { runPair } = await import("../../../src/cli/pair.ts");
    await runPair({ noBrowser: true, force: true });

    expect(keytarMock.setPassword).toHaveBeenCalledWith(
      "agentsofmine-collector",
      "device-token",
      "device-tok-xyz",
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Paired"));

    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
