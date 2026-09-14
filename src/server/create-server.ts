/**
 * Thin MCP server. Registers exactly one tool: show_workspace.
 *
 * The handler is injected. This module does not import `handleShowWorkspace`,
 * `src/engine`, or the catalog — it only moves JSON-RPC frames between a
 * transport and the handler, so the tool contract can change without touching
 * the server. The registered name is `SHOW_WORKSPACE_NAME` from the tool
 * module so it cannot drift from the contract.
 *
 * The wire protocol is hand-rolled because @ui9000/core has no MCP SDK
 * dependency and FUS-4086 may not add one. The sibling mcp-ui repo pins
 * @modelcontextprotocol/sdk 1.30.0 and builds the same surface as
 * `new McpServer(...)` + `server.registerTool(name, config, cb)` +
 * `server.connect(new StdioServerTransport())`. If that dependency is ever
 * added here, swap the body of createServer for those three calls: the
 * exported ShowWorkspaceHandler/McpServer types are shaped to survive it.
 */

import { SHOW_WORKSPACE_NAME } from '../tool/show-workspace.js';

export { SHOW_WORKSPACE_NAME };

/** Injected implementation of show_workspace. Args arrive unparsed from the client. */
export type ShowWorkspaceHandler = (args: unknown) => unknown | Promise<unknown>;

/**
 * Tool metadata. The real description and input schema live with the tool
 * contract (S3-09) and are passed in; a stub may pass 'stub' or nothing.
 */
export type ShowWorkspaceToolInfo = {
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type ToolDescriptor = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type JsonRpcId = string | number;

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpServer = {
  /** Always length 1. Exposed so callers can assert the surface without a round trip. */
  readonly tools: readonly ToolDescriptor[];
  /** Handles one decoded JSON-RPC message. Returns null for notifications. */
  handle(message: unknown): Promise<JsonRpcResponse | null>;
};

export const PROTOCOL_VERSION = '2025-06-18';

export const SERVER_INFO = { name: 'ui9000-core', version: '0.0.0' } as const;

const DEFAULT_INPUT_SCHEMA: Record<string, unknown> = { type: 'object' };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/**
 * Builds the server. One tool, one handler, no registry: a second registerTool
 * call is impossible by construction, so generate_* tools cannot appear.
 */
export function createServer(
  handler: ShowWorkspaceHandler,
  info: ShowWorkspaceToolInfo = {},
): McpServer {
  if (typeof handler !== 'function') {
    throw new TypeError('createServer requires a show_workspace handler function.');
  }

  const tool: ToolDescriptor = {
    name: SHOW_WORKSPACE_NAME,
    inputSchema: info.inputSchema ?? DEFAULT_INPUT_SCHEMA,
  };
  if (info.description !== undefined) {
    tool.description = info.description;
  }
  const tools: readonly ToolDescriptor[] = Object.freeze([tool]);

  async function handle(message: unknown): Promise<JsonRpcResponse | null> {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      return errorResponse(0, INVALID_REQUEST, 'Request must be a JSON-RPC object.');
    }
    const request = message as Record<string, unknown>;
    const method = request.method;
    const id = request.id;

    if (typeof method !== 'string') {
      return errorResponse(isId(id) ? id : 0, INVALID_REQUEST, 'Request is missing a method.');
    }
    // No id means a notification: the protocol forbids a reply.
    if (!isId(id)) return null;

    switch (method) {
      case 'initialize':
        return okResponse(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case 'ping':
        return okResponse(id, {});
      case 'tools/list':
        return okResponse(id, { tools });
      case 'tools/call':
        return callTool(id, request.params);
      default:
        return errorResponse(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  async function callTool(id: JsonRpcId, params: unknown): Promise<JsonRpcResponse> {
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      return errorResponse(id, INVALID_PARAMS, 'tools/call params must be an object.');
    }
    const { name, arguments: args } = params as Record<string, unknown>;
    if (name !== SHOW_WORKSPACE_NAME) {
      return errorResponse(
        id,
        INVALID_PARAMS,
        `Unknown tool: ${String(name)}. This server registers ${SHOW_WORKSPACE_NAME} only.`,
      );
    }

    let result: unknown;
    try {
      result = await handler(args);
    } catch (error) {
      // A throwing handler is a tool error, not a transport error: the client
      // keeps the session and can retry.
      return okResponse(id, {
        content: [{ type: 'text', text: describeError(error) }],
        isError: true,
      });
    }
    return okResponse(id, toolResult(result));
  }

  return { tools, handle };
}

function toolResult(result: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    content: [{ type: 'text', text: stringify(result) }],
  };
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    payload.structuredContent = result;
  }
  return payload;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number';
}

export function okResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function errorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export { PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS };
