import { describe, it, expect, vi } from "vitest";
import { PairingService } from "../../src/services/pairing-service.js";
import { PairingApiError } from "../../src/api/pairing-client.js";

vi.mock("../../src/keychain/index.js", () => ({
  storeDeviceToken: vi.fn(async () => {}),
}));

interface FakeConfig {
  deviceId: string | null;
  written: Record<string, unknown> | null;
  cleared: boolean;
}

function makeConfigRepo(initialDeviceId: string | null = null) {
  const state: FakeConfig = { deviceId: initialDeviceId, written: null, cleared: false };
  const repo = {
    readDeviceId: () => state.deviceId,
    writeDeviceId: (id: string) => {
      state.deviceId = id;
    },
    clearPairingConfig: () => {
      state.cleared = true;
    },
    writePairingConfig: (cfg: Record<string, unknown>) => {
      state.written = cfg;
    },
  };
  return { repo, state };
}

function initResp(overrides: Record<string, unknown> = {}) {
  return {
    pairingCode: "ABC123",
    qrUrl: "https://agentsofmine.io/pair?code=ABC123",
    expiresAt: Date.now() / 1000 + 300,
    pollInterval: 0, // 0s poll so tests don't sleep
    ...overrides,
  };
}

describe("PairingService.runPairFlow", () => {
  it("approved: stores token, persists config, returns deviceId", async () => {
    const { repo, state } = makeConfigRepo("dev-existing");
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => ({ status: "approved", deviceToken: "tok-xyz" })),
    };
    const svc = new PairingService(client as never, repo as never);

    const result = await svc.runPairFlow({ onInitSuccess: () => {} });

    expect(result).toEqual({ status: "approved", deviceId: "dev-existing" });
    expect(state.written).toMatchObject({ deviceId: "dev-existing", deviceToken: "tok-xyz" });
    const { storeDeviceToken } = await import("../../src/keychain/index.js");
    expect(storeDeviceToken).toHaveBeenCalledWith("tok-xyz");
  });

  it("reuses existing deviceId and does not generate a new one", async () => {
    const { repo } = makeConfigRepo("dev-existing");
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => ({ status: "approved", deviceToken: "t" })),
    };
    const svc = new PairingService(client as never, repo as never);
    await svc.runPairFlow({ onInitSuccess: () => {} });
    expect(client.initPairing).toHaveBeenCalledWith("dev-existing");
  });

  it("generates and persists a deviceId when none exists", async () => {
    const { repo, state } = makeConfigRepo(null);
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => ({ status: "approved", deviceToken: "t" })),
    };
    const svc = new PairingService(client as never, repo as never);
    await svc.runPairFlow({ onInitSuccess: () => {} });
    expect(state.deviceId).toBeTruthy();
  });

  it("reset clears existing pairing config first", async () => {
    const { repo, state } = makeConfigRepo("dev-1");
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => ({ status: "approved", deviceToken: "t" })),
    };
    const svc = new PairingService(client as never, repo as never);
    await svc.runPairFlow({ reset: true, onInitSuccess: () => {} });
    expect(state.cleared).toBe(true);
  });

  it("denied: returns denied without writing config", async () => {
    const { repo, state } = makeConfigRepo("dev-1");
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => ({ status: "denied" })),
    };
    const svc = new PairingService(client as never, repo as never);
    const result = await svc.runPairFlow({ onInitSuccess: () => {} });
    expect(result).toEqual({ status: "denied" });
    expect(state.written).toBeNull();
  });

  it("expired: returns expired", async () => {
    const { repo } = makeConfigRepo("dev-1");
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => ({ status: "expired" })),
    };
    const svc = new PairingService(client as never, repo as never);
    const result = await svc.runPairFlow({ onInitSuccess: () => {} });
    expect(result).toEqual({ status: "expired" });
  });

  it("keeps polling on pending then resolves on approved", async () => {
    const { repo } = makeConfigRepo("dev-1");
    let calls = 0;
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => {
        calls++;
        return calls < 2
          ? { status: "pending" }
          : { status: "approved", deviceToken: "t" };
      }),
    };
    const svc = new PairingService(client as never, repo as never);
    const result = await svc.runPairFlow({ onInitSuccess: () => {} });
    expect(result.status).toBe("approved");
    expect(calls).toBe(2);
  });

  it("keeps polling on 5xx server errors", async () => {
    const { repo } = makeConfigRepo("dev-1");
    let calls = 0;
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => {
        calls++;
        if (calls === 1) throw new PairingApiError("server error", 503, "");
        return { status: "approved", deviceToken: "t" };
      }),
    };
    const svc = new PairingService(client as never, repo as never);
    const result = await svc.runPairFlow({ onInitSuccess: () => {} });
    expect(result.status).toBe("approved");
  });

  it("rethrows non-5xx API errors", async () => {
    const { repo } = makeConfigRepo("dev-1");
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => {
        throw new PairingApiError("bad request", 400, "");
      }),
    };
    const svc = new PairingService(client as never, repo as never);
    await expect(svc.runPairFlow({ onInitSuccess: () => {} })).rejects.toThrow(PairingApiError);
  });

  it("approved without deviceToken throws", async () => {
    const { repo } = makeConfigRepo("dev-1");
    const client = {
      initPairing: vi.fn(async () => initResp()),
      pollStatus: vi.fn(async () => ({ status: "approved" })),
    };
    const svc = new PairingService(client as never, repo as never);
    await expect(svc.runPairFlow({ onInitSuccess: () => {} })).rejects.toThrow(/deviceToken/);
  });
});
