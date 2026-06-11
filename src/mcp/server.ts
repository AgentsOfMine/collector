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
import { parseRequest, writeResponse, writeError, RPC_ERRORS } from "./json-rpc.js";

export interface SessionEventParams {
  sessionId: string;
  agentType: "opencode" | "claude-code" | "codex" | (string & {});
  eventType: "session_start" | "session_end" | "message" | "tool_call" | (string & {});
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
      dispatch(trimmed, state);
    }
  });

  // stdio MCP is fire-and-forget from the server side — no explicit listen() needed
}


function dispatch(line: string, state: DaemonState): void {
  const req = parseRequest(line);

  if (!req) {
    state.log(`MCP: invalid JSON-RPC line: ${line.slice(0, 80)}`);
    return;
  }

  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      handleInitialize(id);
      return;

    case "tools/list":
      handleToolsList(id);
      return;

    case "tools/call":
      handleToolsCall(id, params as Record<string, unknown> | undefined, state);
      return;

    default:
      // Silently ack notifications (no id) and return method-not-found for requests
      if (id !== undefined && id !== null) {
        writeError(id, RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
  }
}


function handleInitialize(id: string | number | null | undefined): void {
  writeResponse(id, {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "agentsofmine-collector", version: "0.1.0" },
  });
}

function handleToolsList(id: string | number | null | undefined): void {
  writeResponse(id, {
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
  });
}

function handleToolsCall(
  id: string | number | null | undefined,
  params: Record<string, unknown> | undefined,
  state: DaemonState,
): void {
  const toolName = params?.["name"];
  const args = params?.["arguments"] as SessionEventParams | undefined;

  if (toolName === "session_event" && args) {
    state.log(`MCP event: ${args.agentType} / ${args.eventType} / session=${args.sessionId}`);
    if (state.syncRunner) {
      state.syncRunner.trigger(`mcp session_event: ${args.agentType}/${args.eventType}`);
    } else {
      state.markSynced("mcp");
    }
    writeResponse(id, { content: [{ type: "text", text: "ok" }] });
    return;
  }

  writeError(id, RPC_ERRORS.METHOD_NOT_FOUND, `Unknown tool: ${String(toolName)}`);
}
