/**
 * MCP server entrypoint — stdio transport.
 *
 * Exposes a `session_event` tool so MCP-aware agents (opencode, claude-code)
 * can push session events directly without file polling.
 *
 * This is a minimal stub for Phase 1. The full event schema is defined in
 * schemas/session-event.json (to be finalised alongside POST /sync).
 *
 * Transport: stdio (agents connect via their mcp config block).
 *
 * Example opencode mcp config:
 *   [mcp.agentsofmine]
 *   command = "aom"
 *   args    = ["start"]
 */

import { DaemonState } from "../daemon/state.js";

export interface SessionEventParams {
  sessionId: string;
  agentType: "opencode" | "claude-code" | "codex" | string;
  eventType: "session_start" | "session_end" | "message" | "tool_call" | string;
  payload: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Start the MCP server on stdio.
 *
 * NOTE: Full MCP SDK integration (e.g. @modelcontextprotocol/sdk) will replace
 * this stub once the session-event schema is finalised with the backend team.
 * For now we read JSON-RPC lines from stdin and ack them so agents don't block.
 */
export async function startMcpServer(state: DaemonState): Promise<void> {
  process.stdin.setEncoding("utf8");

  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      handleJsonRpcLine(trimmed, state);
    }
  });

  // stdio MCP is fire-and-forget from the server side — no explicit listen() needed
}

function handleJsonRpcLine(line: string, state: DaemonState): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch {
    state.log(`MCP: invalid JSON line: ${line.slice(0, 80)}`);
    return;
  }

  const id = msg["id"];
  const method = msg["method"] as string | undefined;

  if (method === "initialize") {
    // Respond with server capabilities
    writeJsonRpc({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "agentsofmine-collector", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    writeJsonRpc({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "session_event",
            description:
              "Push a session event to AgentsOfMine. Called automatically by supported agents.",
            inputSchema: {
              type: "object",
              required: ["sessionId", "agentType", "eventType", "payload"],
              properties: {
                sessionId: { type: "string" },
                agentType: { type: "string" },
                eventType: { type: "string" },
                payload: { type: "object" },
                timestamp: { type: "string", format: "date-time" },
              },
            },
          },
        ],
      },
    });
    return;
  }

  if (method === "tools/call") {
    const params = msg["params"] as Record<string, unknown> | undefined;
    const toolName = params?.["name"];
    const args = params?.["arguments"] as SessionEventParams | undefined;

    if (toolName === "session_event" && args) {
      state.log(`MCP event: ${args.agentType} / ${args.eventType} / session=${args.sessionId}`);
      // TODO(phase-1.5): forward to POST /sync via sync-client
      state.markSynced("mcp");

      writeJsonRpc({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "ok" }] },
      });
    } else {
      writeJsonRpc({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${String(toolName)}` },
      });
    }
    return;
  }

  // Silently ack notifications (no id) and ignore unknown methods
  if (id !== undefined) {
    writeJsonRpc({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${String(method)}` },
    });
  }
}

function writeJsonRpc(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
