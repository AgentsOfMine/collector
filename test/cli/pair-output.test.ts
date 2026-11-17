import { describe, it, expect, vi } from "vitest";
import { runPair, type PairDeps } from "../../src/cli/pair.js";
import { PairingApiError } from "../../src/api/pairing-client.js";
import type { PairFlowOptions, PairFlowResult } from "../../src/services/pairing-service.js";
import { memoryTerminal } from "./memory-terminal.js";

const INIT = { pairingCode: "ABC-123", qrUrl: "https://agentsofmine.io/pair?c=ABC", expiresInMinutes: 5, pollIntervalMs: 2000 };

/** A pairing flow that reports init, ticks twice, then resolves with `result`. */
function flow(result: PairFlowResult) {
  return vi.fn(async (opts: PairFlowOptions): Promise<PairFlowResult> => {
    opts.onInitSuccess(INIT);
    opts.onPollTick?.(0);
    opts.onPollTick?.(1);
    return result;
  });
}

function deps(over: Partial<PairDeps> = {}): PairDeps & { openBrowser: ReturnType<typeof vi.fn> } {
  return {
    isPaired: async () => false,
    runPairFlow: flow({ status: "approved", deviceId: "d1" }),
    openBrowser: vi.fn(async () => undefined),
    renderQr: () => "[QR]",
    ...over,
  } as never;
}

describe("aom pair", () => {
  it("returns 0 and confirms when approved", async () => {
    const term = memoryTerminal();
    expect(await runPair(term, {}, deps())).toBe(0);
    expect(term.text()).toContain("Paired!");
    expect(term.text()).toContain("aom start");
  });

  it("shows the code, the URL, the QR and the safety warning", async () => {
    const term = memoryTerminal();
    await runPair(term, {}, deps());
    expect(term.text()).toContain("ABC-123");
    expect(term.text()).toContain(INIT.qrUrl);
    expect(term.text()).toContain("[QR]");
    expect(term.text()).toContain("Only approve if you just ran this command");
    expect(term.text()).toContain("~5 minutes");
  });

  it("animates a spinner through write(), not stdout lines", async () => {
    const term = memoryTerminal();
    await runPair(term, {}, deps());
    expect(term.written).toContain("Requesting pairing code");
    expect(term.written).toContain("⠋ Waiting…");
    expect(term.written).toContain("⠙ Waiting…");
  });

  it("opens the browser unless told not to", async () => {
    const d1 = deps();
    await runPair(memoryTerminal(), {}, d1);
    expect(d1.openBrowser).toHaveBeenCalledWith(INIT.qrUrl);

    const d2 = deps();
    await runPair(memoryTerminal(), { noBrowser: true }, d2);
    expect(d2.openBrowser).not.toHaveBeenCalled();
  });

  it("does not fail pairing when the browser cannot be opened", async () => {
    const d = deps({ openBrowser: vi.fn(async () => Promise.reject(new Error("no display"))) });
    expect(await runPair(memoryTerminal(), {}, d)).toBe(0);
  });

  it("returns 0 without pairing again when already paired", async () => {
    const term = memoryTerminal();
    const d = deps({ isPaired: async () => true });
    expect(await runPair(term, {}, d)).toBe(0);
    expect(term.text()).toContain("already paired");
    expect(term.text()).toContain("aom pair --force");
    expect(d.runPairFlow).not.toHaveBeenCalled();
  });

  it("--force pairs again and tells the flow to reset", async () => {
    const d = deps({ isPaired: async () => true });
    await runPair(memoryTerminal(), { force: true }, d);
    expect(d.runPairFlow).toHaveBeenCalledOnce();
    expect(vi.mocked(d.runPairFlow).mock.calls[0]![0].reset).toBe(true);
  });

  it("passes the API base URL override through", async () => {
    const d = deps();
    await runPair(memoryTerminal(), { apiBaseUrl: "https://staging.example" }, d);
    expect(vi.mocked(d.runPairFlow).mock.calls[0]![1]).toBe("https://staging.example");
  });

  it("returns 1 on denial, on stderr", async () => {
    const term = memoryTerminal();
    expect(await runPair(term, {}, deps({ runPairFlow: flow({ status: "denied" }) }))).toBe(1);
    expect(term.errText()).toContain("denied");
    expect(term.errText()).toContain("aom pair");
  });

  it("returns 1 when the code expired", async () => {
    const term = memoryTerminal();
    expect(await runPair(term, {}, deps({ runPairFlow: flow({ status: "expired" }) }))).toBe(1);
    expect(term.errText()).toContain("expired");
  });

  it.each([
    [429, "Too many requests"],
    [503, "Server error"],
    [400, "bad thing"],
  ])("returns 1 and explains an HTTP %i", async (status, expected) => {
    const term = memoryTerminal();
    const d = deps({ runPairFlow: vi.fn(async () => Promise.reject(new PairingApiError("x", status, "bad thing"))) });
    expect(await runPair(term, {}, d)).toBe(1);
    expect(term.errText()).toContain(`HTTP ${status}`);
    expect(term.errText()).toContain(expected);
  });

  it("returns 1 and blames the network for other errors", async () => {
    const term = memoryTerminal();
    const d = deps({ runPairFlow: vi.fn(async () => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) });
    expect(await runPair(term, {}, d)).toBe(1);
    expect(term.errText()).toContain("Network error");
    expect(term.errText()).toContain("ENOTFOUND");
  });
});
