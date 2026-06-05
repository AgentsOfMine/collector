/**
 * JSON-RPC 2.0 helpers for the MCP stdio transport.
 *
 * Keeps protocol framing separate from handler dispatch logic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw JSON string into a JsonRpcRequest.
 * Returns null (and logs) if the line is not valid JSON-RPC.
 */
export function parseRequest(line: string): JsonRpcRequest | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (typeof msg["method"] !== "string") return null;

  return {
    jsonrpc: "2.0",
    id: msg["id"] as string | number | null | undefined,
    method: msg["method"] as string,
    params: msg["params"],
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Write a successful JSON-RPC response to stdout. */
export function writeResponse(id: string | number | null | undefined, result: unknown): void {
  writeRaw({ jsonrpc: "2.0", id, result });
}

/** Write a JSON-RPC error response to stdout. */
export function writeError(
  id: string | number | null | undefined,
  code: number,
  message: string,
): void {
  writeRaw({ jsonrpc: "2.0", id, error: { code, message } });
}

function writeRaw(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
