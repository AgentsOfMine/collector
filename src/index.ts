import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { cursorStore } from "./core/cursor-store.js";
import { OpenCodeAdapter } from "./adapters/opencode/index.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code/index.js";
import { CodexAdapter } from "./adapters/codex/index.js";
import { syncNow } from "./mcp-tools/sync-now.js";
import { getStatusPayload } from "./mcp-tools/status.js";

const config = await loadConfig();

const adapters = [
  new OpenCodeAdapter(config.opencodeDbPath),
  new ClaudeCodeAdapter(config.claudeProjectsGlob),
  new CodexAdapter(config.codexSessionsDir),
];

const syncConfig = {
  syncUrl: config.syncUrl,
  deviceId: config.deviceId,
  deviceToken: config.deviceToken,
  collectorVersion: config.collectorVersion,
};

const server = new Server(
  { name: "agentsofmine-collector", version: config.collectorVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "sync_now",
      description: "Trigger an immediate sync of all agent sessions to AgentsOfMine backend.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "status",
      description: "Return the result of the last sync operation.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  if (name === "sync_now") {
    const result = await syncNow(adapters, syncConfig, cursorStore);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === "status") {
    const status = getStatusPayload();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
