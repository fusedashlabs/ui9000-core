/**
 * Streamable HTTP for Claude.ai / ChatGPT connectors. Stdio stays the Cursor path.
 * Stateless: one SDK server + transport per request (same as mcp-ui POST /mcp).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  applyWorkspaceHostDefaults,
  readDotEnv,
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

const CORS_METHODS = 'GET, POST, DELETE, OPTIONS';
const CORS_ALLOW_HEADERS = 'content-type, mcp-session-id, mcp-protocol-version';
const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

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

export function wireWorkspaceHttp(options: CreateWorkspaceServerOptions = {}): WiredWorkspace {
  const env = applyWorkspaceHostDefaults(options.env ?? process.env);
  const dataPath =
    options.dataPath ??
    resolveWorkspaceDataPath(env[WORKSPACE_DATA_PATH_ENV], options.root) ??
    workspaceDemoCsvPath();
  return wireWorkspace({ ...options, env, dataPath, allowRemoteSources: false });
}

export async function handleWorkspaceMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
  options: CreateWorkspaceServerOptions = {},
): Promise<void> {
  applyWorkspaceHttpCors(res, headerOrigin(req));
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
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
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
  };
  res.on('close', close);
  try {
    await server.connect(transport);
    const body = parsedBody !== undefined ? parsedBody : await readJsonBody(req);
    await transport.handleRequest(req, res, body);
    if (res.writableEnded || res.destroyed) close();
  } catch (error) {
    if (!res.headersSent) {
      const tooLarge = error instanceof HttpBodyError;
      const status = tooLarge ? 413 : 400;
      const code = tooLarge ? -32600 : -32700;
      const message = error instanceof Error ? error.message : 'MCP request failed';
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }));
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
  }
}

export async function startWorkspaceHttpServer(
  options: WorkspaceHttpListenOptions = {},
): Promise<WorkspaceHttpServer> {
  const env = applyWorkspaceHostDefaults(options.env ?? readDotEnv(process.env));
  const mcpPath = options.path ?? WORKSPACE_HTTP_PATH;
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? Number(env.PORT || DEFAULT_WORKSPACE_HTTP_PORT);
  const extraHosts = (env.MCP_HTTP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const httpServer = createServer((req, res) => {
    void (async () => {
      const origin = headerOrigin(req);
      applyWorkspaceHttpCors(res, origin, extraHosts);
      if (!requestAllowed(req, extraHosts)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('forbidden host');
        return;
      }
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
      await dispatchWorkspaceMcp(req, res, wireWorkspaceHttp({ ...options, env }));
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

class HttpBodyError extends Error {}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    return undefined;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_HTTP_BODY_BYTES) {
      throw new HttpBodyError(`HTTP body exceeds ${MAX_HTTP_BODY_BYTES} bytes.`);
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

export function applyWorkspaceHttpCors(
  res: ServerResponse,
  origin: string | undefined,
  extraHosts: readonly string[] = [],
): void {
  res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
  res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  res.setHeader('Vary', 'Origin');
  if (origin && isAllowedHttpHost(hostnameOf(origin), extraHosts)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
}

function requestAllowed(req: IncomingMessage, extraHosts: readonly string[]): boolean {
  const host = requestHostname(req);
  if (host && !isAllowedHttpHost(host, extraHosts)) return false;
  const origin = headerOrigin(req);
  if (origin && !isAllowedHttpHost(hostnameOf(origin), extraHosts)) return false;
  return true;
}

export function isAllowedHttpHost(host: string, extraHosts: readonly string[] = []): boolean {
  const name = host.trim().toLowerCase();
  if (!name) return true;
  return LOOPBACK_HOSTS.has(name) || extraHosts.includes(name);
}

function headerOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin;
  return typeof origin === 'string' && origin.trim() ? origin.trim() : undefined;
}

function requestHostname(req: IncomingMessage): string {
  const raw = req.headers.host ?? '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 1 ? raw.slice(1, end).toLowerCase() : '';
  }
  return raw.split(':')[0]?.toLowerCase() ?? '';
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return origin.toLowerCase();
  }
}
