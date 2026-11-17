import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { startMcpServer } from "../src/mcp/server.js";
import type { DaemonState } from "../src/daemon/state.js";

function state() {
  const trigger = vi.fn();
  const s = { log: vi.fn(), syncRunner: { trigger }, markSynced: vi.fn() } as unknown as DaemonState;
  return { s, trigger };
}

describe("startMcpServer handle", () => {
  it("handles a session_event until stopped", async () => {
    const input = new PassThrough();
    const { s, trigger } = state();
    const handle = await startMcpServer(s, input);

    const call = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "session_event", arguments: { sessionId: "s", agentType: "pi", eventType: "message", payload: {} } },
    });
    input.write(call + "\n");
    await vi.waitFor(() => expect(trigger).toHaveBeenCalledOnce());

    handle.stop();
    input.write(call + "\n");
    await new Promise((r) => setTimeout(r, 20));
    expect(trigger).toHaveBeenCalledOnce();
  });

  it("stop() detaches the listener and pauses stdin so the process can exit", async () => {
    const input = new PassThrough();
    const handle = await startMcpServer(state().s, input);
    expect(input.listenerCount("data")).toBe(1);

    handle.stop();

    expect(input.listenerCount("data")).toBe(0);
    expect(input.isPaused()).toBe(true);
  });

  it("buffers a line split across chunks", async () => {
    const input = new PassThrough();
    const { s, trigger } = state();
    await startMcpServer(s, input);
    const call = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "session_event", arguments: { sessionId: "s", agentType: "pi", eventType: "x", payload: {} } },
    });
    input.write(call.slice(0, 30));
    await new Promise((r) => setTimeout(r, 10));
    expect(trigger).not.toHaveBeenCalled();
    input.write(call.slice(30) + "\n");
    await vi.waitFor(() => expect(trigger).toHaveBeenCalledOnce());
  });
});
