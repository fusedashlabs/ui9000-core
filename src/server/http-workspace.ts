/**
 * Streamable HTTP for Claude.ai / ChatGPT connectors. Stdio stays the Cursor path.
 * Stateless: one SDK server + transport per request (same as mcp-ui POST /mcp).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  applyWorkspaceHostDefaults,
  resolveWorkspaceDataPath,
  wireWorkspace,
  workspaceDemoCsvPath,
  WORKSPACE_DATA_PATH_ENV,
  type CreateWorkspaceServerOptions,
  type WiredWorkspace,
} from '../workspace-server.js';
import { createSdkWorkspaceServer } from './sdk-workspace.js';

export const WORKSPACE_HTTP_PATH = '/mcp';
export const DEFAULT_WORKSPACE_HTTP_PORT = 8090;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

export type WorkspaceHttpListenOptions = CreateWorkspaceServerOptions & {
  port?: number;
  host?: string;
  path?: string;
};

export type WorkspaceHttpServer = {
  url: string;
  port: number;
  path: string;
  close: () => Promise<void>;
};

export function applyWorkspaceHttpCors(res: ServerResponse): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

export function wireWorkspaceHttp(options: CreateWorkspaceServerOptions = {}): WiredWorkspace {
  const env = applyWorkspaceHostDefaults(options.env ?? process.env);
  const dataPath =
    options.dataPath ??
    resolveWorkspaceDataPath(env[WORKSPACE_DATA_PATH_ENV], options.root) ??
    workspaceDemoCsvPath();
  return wireWorkspace({ ...options, env, dataPath });
}

export async function handleWorkspaceMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
  options: CreateWorkspaceServerOptions = {},
): Promise<void> {
  applyWorkspaceHttpCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  await dispatchWorkspaceMcp(req, res, wireWorkspaceHttp(options), parsedBody);
}

async function dispatchWorkspaceMcp(
  req: IncomingMessage,
  res: ServerResponse,
  wired: WiredWorkspace,
  parsedBody?: unknown,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createSdkWorkspaceServer(wired.handler, wired.info);
  try {
    await server.connect(transport);
    const body = parsedBody !== undefined ? parsedBody : await readJsonBody(req);
    await transport.handleRequest(req, res, body);
    res.on('close', () => {
      try {
        void transport.close();
      } catch {
        /* ignore */
      }
      try {
        void server.close();
      } catch {
        /* ignore */
      }
    });
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('MCP request failed');
    }
    try {
      void transport.close();
    } catch {
      /* ignore */
    }
    try {
      await server.close();
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export async function startWorkspaceHttpServer(
  options: WorkspaceHttpListenOptions = {},
): Promise<WorkspaceHttpServer> {
  const env = applyWorkspaceHostDefaults(options.env ?? process.env);
  const wired = wireWorkspaceHttp({ ...options, env });
  const mcpPath = options.path ?? WORKSPACE_HTTP_PATH;
  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? Number(env.PORT || DEFAULT_WORKSPACE_HTTP_PORT);

  const httpServer = createServer((req, res) => {
    void (async () => {
      applyWorkspaceHttpCors(res);
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === '/health' || url.pathname === '/health/') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      if (url.pathname !== mcpPath && url.pathname !== `${mcpPath}/`) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      await dispatchWorkspaceMcp(req, res, wired);
    })().catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      );
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('MCP request failed');
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address() as AddressInfo;
  const boundHost = address.address === '0.0.0.0' ? '127.0.0.1' : address.address;
  const url = `http://${boundHost}:${address.port}`;

  return {
    url,
    port: address.port,
    path: mcpPath,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}
