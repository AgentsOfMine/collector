import { describe, it, expect, vi } from "vitest";
import { runStart, type StartDeps, type Watcher } from "../../src/cli/start.js";
import type { DaemonState } from "../../src/daemon/state.js";
import type { SyncRunner } from "../../src/daemon/sync-runner.js";
import { memoryTerminal } from "./memory-terminal.js";

function fakeWatcher(name: string, log: string[]): Watcher {
  return {
    name,
    start: vi.fn(async () => void log.push(`start ${name}`)),
    stop: vi.fn(async () => void log.push(`stop ${name}`)),
  };
}

function harness(over: Partial<StartDeps> = {}) {
  const log: string[] = [];
  const runner = {
    runNow: vi.fn(async () => void log.push("initial sync")),
    stop: vi.fn(() => void log.push("stop runner")),
  } as unknown as SyncRunner;
  const state = { log: vi.fn() } as unknown as DaemonState;
  let release!: () => void;
  const stopped = new Promise<void>((resolve) => (release = resolve));

  const deps: StartDeps = {
    isPaired: async () => true,
    getDeviceToken: async () => "tok",
    loadConfig: vi.fn(async () => ({ opencodeDbPath: "/db" }) as never),
    createState: vi.fn(() => state),
    createRunner: vi.fn(() => runner),
    createWatchers: vi.fn(() => [fakeWatcher("opencode", log), fakeWatcher("pi", log)]),
    untilStopped: () => stopped,
    ...over,
  };
  return { deps, log, runner, state, release };
}

describe("aom start", () => {
  it("returns 1 with the pair hint when not paired, starting nothing", async () => {
    const term = memoryTerminal();
    const { deps } = harness({ isPaired: async () => false });
    expect(await runStart(term, {}, deps)).toBe(1);
    expect(term.errText()).toContain("not paired");
    expect(deps.createWatchers).not.toHaveBeenCalled();
  });

  it("returns 1 when paired but the token is gone", async () => {
    const term = memoryTerminal();
    const { deps } = harness({ getDeviceToken: async () => null });
    expect(await runStart(term, {}, deps)).toBe(1);
    expect(term.errText()).toContain("Device token missing");
    expect(deps.createWatchers).not.toHaveBeenCalled();
  });

  it("starts the watchers and an initial sync, in that order, then waits", async () => {
    const term = memoryTerminal();
    const { deps, log, release } = harness();

    const running = runStart(term, {}, deps);
    await vi.waitFor(() => expect(log).toContain("initial sync"));

    expect(log).toEqual(["start opencode", "start pi", "initial sync"]);
    expect(term.text()).toContain("opencode watcher active");
    expect(term.text()).toContain("pi watcher active");
    expect(term.text()).not.toContain("MCP");
    expect(term.text()).toContain("Press Ctrl+C to stop");

    let done = false;
    void running.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false); // still running until told to stop

    release();
    expect(await running).toBe(0);
  });

  it("shuts down in order when stopped: runner first, then every watcher, and returns 0", async () => {
    const term = memoryTerminal();
    const { deps, log, release } = harness();

    const running = runStart(term, {}, deps);
    await vi.waitFor(() => expect(log).toContain("initial sync"));
    release();

    expect(await running).toBe(0);
    expect(log.slice(-3)).toEqual(["stop runner", "stop opencode", "stop pi"]);
    expect(term.text()).toContain("Shutting down");
  });

  it("hands the same runner to the watchers, so a file change triggers a sync", async () => {
    const { deps, runner, state, release } = harness();
    const running = runStart(memoryTerminal(), {}, deps);
    await vi.waitFor(() => expect(runner.runNow).toHaveBeenCalled());
    expect(deps.createWatchers).toHaveBeenCalledWith(state, runner, expect.anything());
    release();
    await running;
  });

  it("passes the token and verbosity to the daemon state", async () => {
    const { deps, release } = harness();
    const running = runStart(memoryTerminal(), { verbose: true }, deps);
    await vi.waitFor(() => expect(deps.createState).toHaveBeenCalled());
    expect(deps.createState).toHaveBeenCalledWith({ deviceToken: "tok", verbose: true });
    release();
    await running;
  });

  it("does not call process.exit", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { deps, release } = harness();
    const running = runStart(memoryTerminal(), {}, deps);
    await vi.waitFor(() => expect(deps.createWatchers).toHaveBeenCalled());
    release();
    await running;
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});

describe("aom start does not run an MCP server", () => {
  it("leaves stdin alone, so the real MCP entrypoint and the terminal are not fought over", async () => {
    const before = process.stdin.listenerCount("data");
    const { deps, release } = harness();
    const running = runStart(memoryTerminal(), {}, deps);
    await vi.waitFor(() => expect(deps.createWatchers).toHaveBeenCalled());
    expect(process.stdin.listenerCount("data")).toBe(before);
    release();
    await running;
  });
});
