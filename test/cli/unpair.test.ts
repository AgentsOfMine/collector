import { describe, it, expect, vi } from "vitest";
import { runUnpair, type UnpairDeps } from "../../src/cli/unpair.js";
import { memoryTerminal } from "./memory-terminal.js";

function deps(over: Partial<UnpairDeps> = {}): UnpairDeps & {
  deleteDeviceToken: ReturnType<typeof vi.fn>;
  clearLocalState: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
} {
  return {
    isPaired: async () => true,
    deleteDeviceToken: vi.fn(async () => true),
    clearLocalState: vi.fn(),
    confirm: vi.fn(async () => true),
    ...over,
  } as never;
}

describe("aom unpair", () => {
  it("does nothing, successfully, when not paired", async () => {
    const term = memoryTerminal();
    const d = deps({ isPaired: async () => false });
    expect(await runUnpair(term, {}, d)).toBe(0);
    expect(term.text()).toContain("not currently paired");
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.deleteDeviceToken).not.toHaveBeenCalled();
    expect(d.clearLocalState).not.toHaveBeenCalled();
  });

  it("asks first, then removes the token and local state", async () => {
    const term = memoryTerminal();
    const d = deps();
    expect(await runUnpair(term, {}, d)).toBe(0);
    expect(d.confirm).toHaveBeenCalledOnce();
    expect(d.confirm.mock.calls[0]![0]).toContain("[y/N]");
    expect(d.deleteDeviceToken).toHaveBeenCalledOnce();
    expect(d.clearLocalState).toHaveBeenCalledOnce();
    expect(term.text()).toContain("Device token removed");
    expect(term.text()).toContain("Local collector state cleared");
    expect(term.text()).toContain("aom pair");
  });

  it("changes nothing when the answer is no", async () => {
    const term = memoryTerminal();
    const d = deps({ confirm: vi.fn(async () => false) });
    expect(await runUnpair(term, {}, d)).toBe(0);
    expect(term.text()).toContain("Aborted.");
    expect(d.deleteDeviceToken).not.toHaveBeenCalled();
    expect(d.clearLocalState).not.toHaveBeenCalled();
  });

  it("--yes skips the question", async () => {
    const term = memoryTerminal();
    const d = deps();
    await runUnpair(term, { yes: true }, d);
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.deleteDeviceToken).toHaveBeenCalledOnce();
    expect(d.clearLocalState).toHaveBeenCalledOnce();
  });

  it("still clears local state when no keychain entry existed, without claiming it removed one", async () => {
    const term = memoryTerminal();
    const d = deps({ deleteDeviceToken: vi.fn(async () => false) });
    await runUnpair(term, { yes: true }, d);
    expect(term.text()).not.toContain("Device token removed");
    expect(d.clearLocalState).toHaveBeenCalledOnce();
  });

  it("reminds the user to revoke the device on the website", async () => {
    const term = memoryTerminal();
    await runUnpair(term, { yes: true }, deps());
    expect(term.text()).toContain("https://agentsofmine.io");
    expect(term.text()).toContain("Revoke");
  });
});
