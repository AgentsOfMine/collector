import { describe, it, expect } from "vitest";
import { runStatus, buildStatusFrom, type StatusDeps } from "../../src/cli/status.js";
import { memoryTerminal } from "./memory-terminal.js";

const NOW = Date.parse("2026-11-17T12:00:00.000Z");

function deps(over: Partial<StatusDeps> = {}): StatusDeps {
  return {
    isPaired: async () => true,
    getDeviceToken: async () => "secret-token-value",
    readDeviceId: () => "dev-123",
    readLastSync: () => ({ sync: "2026-11-17T11:55:00.000Z", daemon: "2026-11-16T12:00:00.000Z" }),
    now: () => NOW,
    ...over,
  };
}

describe("buildStatusFrom", () => {
  it("reports the newest timestamp and stable placeholders", () => {
    const s = buildStatusFrom(true, deps());
    expect(s).toEqual({
      paired: true,
      deviceId: "dev-123",
      lastSyncAt: "2026-11-17T11:55:00.000Z",
      queueDepth: 0,
      lastError: null,
    });
  });

  it("has null fields when nothing is known", () => {
    const s = buildStatusFrom(false, deps({ readDeviceId: () => null, readLastSync: () => ({}) }));
    expect(s.deviceId).toBeNull();
    expect(s.lastSyncAt).toBeNull();
  });
});

describe("aom status", () => {
  it("--json prints one parseable object and nothing else", async () => {
    const term = memoryTerminal(true);
    expect(await runStatus(term, { json: true }, deps())).toBe(0);
    expect(term.stdout).toHaveLength(1);
    expect(term.stdout[0]).not.toContain("\x1b[");
    expect(JSON.parse(term.stdout[0]!)).toMatchObject({ paired: true, deviceId: "dev-123" });
  });

  it("--json works when not paired", async () => {
    const term = memoryTerminal();
    await runStatus(term, { json: true }, deps({ isPaired: async () => false }));
    expect(JSON.parse(term.stdout[0]!).paired).toBe(false);
  });

  it("tells an unpaired user how to pair, and shows nothing else", async () => {
    const term = memoryTerminal();
    expect(await runStatus(term, {}, deps({ isPaired: async () => false }))).toBe(0);
    expect(term.text()).toContain("no");
    expect(term.text()).toContain("aom pair");
    expect(term.text()).not.toContain("Device ID");
    expect(term.text()).not.toContain("Last synced");
  });

  it("shows device id, token presence and relative sync times", async () => {
    const term = memoryTerminal();
    await runStatus(term, {}, deps());
    expect(term.text()).toContain("dev-123");
    expect(term.text()).toContain("present in keychain");
    expect(term.text()).toContain("5m ago");
    expect(term.text()).toContain("1d ago");
  });

  it("never prints the token itself", async () => {
    const term = memoryTerminal();
    await runStatus(term, {}, deps());
    expect(term.text()).not.toContain("secret-token-value");
  });

  it("flags a missing token", async () => {
    const term = memoryTerminal();
    await runStatus(term, {}, deps({ getDeviceToken: async () => null }));
    expect(term.text()).toContain("missing");
  });

  it("says nothing has synced and how to start", async () => {
    const term = memoryTerminal();
    await runStatus(term, {}, deps({ readLastSync: () => ({}) }));
    expect(term.text()).toContain("No sessions synced yet");
    expect(term.text()).toContain("aom start");
  });
});
