import { describe, it, expect, vi } from "vitest";
import { runSyncCommand, type SyncDeps } from "../../src/cli/sync.js";
import { NotPairedError } from "../../src/core/perform-sync.js";
import { memoryTerminal } from "./memory-terminal.js";

function deps(over: Partial<SyncDeps> = {}): SyncDeps {
  return {
    isPaired: async () => true,
    performSync: async () => ({ synced: 0, failed: 0, errors: [] }),
    ...over,
  };
}

describe("aom sync output and exit codes", () => {
  it("prints the count and returns 0 on a clean sync", async () => {
    const term = memoryTerminal();
    const code = await runSyncCommand(term, {}, deps({ performSync: async () => ({ synced: 5, failed: 0, errors: [] }) }));
    expect(code).toBe(0);
    expect(term.text()).toContain("synced  5");
    expect(term.text()).not.toContain("failed");
    expect(term.stderr).toEqual([]);
  });

  it("returns 1 and says how many failed", async () => {
    const term = memoryTerminal();
    const code = await runSyncCommand(
      term,
      {},
      deps({ performSync: async () => ({ synced: 2, failed: 3, errors: ["a: x", "b: y", "c: z"] }) }),
    );
    expect(code).toBe(1);
    expect(term.text()).toContain("failed  3");
  });

  it("hides error detail without -v and points at the flag", async () => {
    const term = memoryTerminal();
    await runSyncCommand(term, {}, deps({ performSync: async () => ({ synced: 0, failed: 1, errors: ["opencode/s1: rejected"] }) }));
    expect(term.text()).toContain("1 error(s). Re-run with -v for detail.");
    expect(term.text()).not.toContain("opencode/s1");
  });

  it("prints each error with -v", async () => {
    const term = memoryTerminal();
    await runSyncCommand(
      term,
      { verbose: true },
      deps({ performSync: async () => ({ synced: 0, failed: 2, errors: ["opencode/s1: rejected", "pi/s2: bad"] }) }),
    );
    expect(term.text()).toContain("opencode/s1: rejected");
    expect(term.text()).toContain("pi/s2: bad");
    expect(term.text()).not.toContain("Re-run with -v");
  });

  it("returns 1 with the pair hint when not paired, without syncing", async () => {
    const term = memoryTerminal();
    const performSync = vi.fn();
    const code = await runSyncCommand(term, {}, deps({ isPaired: async () => false, performSync }));
    expect(code).toBe(1);
    expect(performSync).not.toHaveBeenCalled();
    expect(term.errText()).toContain("not paired");
    expect(term.errText()).toContain("aom pair");
    expect(term.stdout).toEqual([]);
  });

  it("returns 1 when the token disappears between the check and the sync", async () => {
    const term = memoryTerminal();
    const code = await runSyncCommand(
      term,
      {},
      deps({
        performSync: async () => {
          throw new NotPairedError();
        },
      }),
    );
    expect(code).toBe(1);
    expect(term.errText()).toContain("Device token missing");
  });

  it("lets unexpected errors propagate instead of hiding them behind an exit code", async () => {
    const term = memoryTerminal();
    await expect(
      runSyncCommand(term, {}, deps({ performSync: async () => Promise.reject(new Error("disk on fire")) })),
    ).rejects.toThrow("disk on fire");
  });

  it("adds no escape codes when color is off, and some when it is on", async () => {
    const plain = memoryTerminal(false);
    const colored = memoryTerminal(true);
    const run = (t: ReturnType<typeof memoryTerminal>) =>
      runSyncCommand(t, {}, deps({ performSync: async () => ({ synced: 1, failed: 1, errors: ["x"] }) }));
    await run(plain);
    await run(colored);
    expect(plain.text()).not.toContain("\x1b[");
    expect(colored.text()).toContain("\x1b[");
  });
});
