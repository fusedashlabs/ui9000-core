import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TtlStore, readDataLink, resetDataLinkStoreForTests } from './migrate/datalink/index.js';
import { parseCsvTable } from './profiler/table.js';
import type { JsonRpcResponse } from './server/index.js';
import { attachDataHandle, isOpaqueDataUrl } from './tool/data-channel.js';
import { SHOW_WORKSPACE_DESCRIPTION, SHOW_WORKSPACE_NAME } from './tool/show-workspace.js';
import {
  createServer,
  createWorkspaceServer,
  handleShowWorkspace,
  resolveWorkspaceDataPath,
  signDataLink,
  startWorkspaceServer,
} from './index.js';

const FIXTURE = fileURLToPath(
  new URL('../tests/fixtures/profiles/category-metric.csv', import.meta.url),
);

const TEST_ENV: NodeJS.ProcessEnv = {
  MCP_DATA_LINK_SECRET: 'test-only-secret-value-32-chars-min',
  MCP_BASE_URL: 'https://workspace.local',
};

let dir: string;
let store: TtlStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui9000-workspace-server-'));
  store = new TtlStore(undefined, dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function request(method: string, params?: unknown, id: string | number = 1) {
  return { jsonrpc: '2.0' as const, id, method, ...(params === undefined ? {} : { params }) };
}

function resultOf(response: JsonRpcResponse | null): Record<string, unknown> {
  expect(response?.error).toBeUndefined();
  return response?.result as Record<string, unknown>;
}

function wiredServer() {
  const csv = fs.readFileSync(FIXTURE, 'utf8');
  return createWorkspaceServer({
    env: TEST_ENV,
    table: parseCsvTable(csv),
    store,
  });
}

describe('createWorkspaceServer', () => {
  it('re-exports the C16 public surface', () => {
    expect(typeof createWorkspaceServer).toBe('function');
    expect(typeof createServer).toBe('function');
    expect(typeof handleShowWorkspace).toBe('function');
    expect(typeof signDataLink).toBe('function');
  });

  it('lists exactly one tool named show_workspace', async () => {
    const server = wiredServer();
    expect(server.tools).toHaveLength(1);

    const result = resultOf(await server.handle(request('tools/list')));
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe(SHOW_WORKSPACE_NAME);
    expect(tools[0]?.description).toBe(SHOW_WORKSPACE_DESCRIPTION);
    expect(tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      required: ['intent'],
    });
  });

  it('routes show_workspace through handleShowWorkspace, not a stub', async () => {
    const server = wiredServer();
    const result = resultOf(
      await server.handle(
        request('tools/call', { name: SHOW_WORKSPACE_NAME, arguments: { intent: 'comparison' } }),
      ),
    );

    const body = result.structuredContent as {
      ok: boolean;
      spec?: { component?: string; dataUrl?: string };
      summary?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.spec?.component).toBe('bar-chart');
    expect(body.spec?.dataUrl).toEqual(expect.any(String));
    expect(isOpaqueDataUrl(body.spec!.dataUrl!)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Engineering');
    expect(JSON.stringify(result)).not.toContain('120.5');

    const payload = readDataLink({ dataUrl: body.spec!.dataUrl! }, { env: TEST_ENV, store });
    expect(payload).toEqual(expect.arrayContaining([expect.objectContaining({ department: 'Engineering' })]));
  });

  it('refuses dataset rows in arguments', async () => {
    const server = wiredServer();
    const result = resultOf(
      await server.handle(
        request('tools/call', {
          name: SHOW_WORKSPACE_NAME,
          arguments: { intent: 'comparison', data: [{ department: 'Engineering' }] },
        }),
      ),
    );

    const body = result.structuredContent as { ok: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('rows_in_args');
  });

  it('refuses generate_* before the engine runs', async () => {
    const server = wiredServer();
    const response = await server.handle(
      request('tools/call', { name: 'generate_simple_single_series_chart', arguments: {} }),
    );
    expect(response?.error?.code).toBe(-32602);
  });

  it('loads the dataset from dataPath', async () => {
    const server = createWorkspaceServer({ env: TEST_ENV, dataPath: FIXTURE, store });
    const result = resultOf(
      await server.handle(
        request('tools/call', { name: SHOW_WORKSPACE_NAME, arguments: { intent: 'comparison' } }),
      ),
    );
    const body = result.structuredContent as { ok: boolean; spec?: { component?: string } };
    expect(body.ok).toBe(true);
    expect(body.spec?.component).toBe('bar-chart');
  });

  it('keeps secret and STORAGE_DIR in the same env bag when no store is passed', async () => {
    const env = { ...TEST_ENV, STORAGE_DIR: dir };
    const server = createWorkspaceServer({
      env,
      table: parseCsvTable(fs.readFileSync(FIXTURE, 'utf8')),
    });
    const result = resultOf(
      await server.handle(
        request('tools/call', { name: SHOW_WORKSPACE_NAME, arguments: { intent: 'comparison' } }),
      ),
    );
    const body = result.structuredContent as { ok: boolean; spec?: { dataUrl?: string } };
    expect(body.ok).toBe(true);
    expect(isOpaqueDataUrl(body.spec?.dataUrl ?? '')).toBe(true);

    const envStore = new TtlStore(undefined, dir);
    const payload = readDataLink({ dataUrl: body.spec!.dataUrl! }, { env, store: envStore });
    expect(payload).toEqual(
      expect.arrayContaining([expect.objectContaining({ department: 'Engineering' })]),
    );
    expect(fs.readdirSync(dir).some((name) => name.endsWith('.json'))).toBe(true);
  });
});

describe('resolveWorkspaceDataPath', () => {
  it('resolves a relative path against the package root, not cwd', () => {
    expect(resolveWorkspaceDataPath('fixtures/data.csv', '/pkg/core')).toBe(
      path.resolve('/pkg/core', 'fixtures/data.csv'),
    );
    expect(resolveWorkspaceDataPath('/abs/data.csv', '/pkg/core')).toBe('/abs/data.csv');
    expect(resolveWorkspaceDataPath('  ', '/pkg/core')).toBeUndefined();
    expect(resolveWorkspaceDataPath(undefined, '/pkg/core')).toBeUndefined();
  });
});

describe('attachDataHandle migrate default', () => {
  it('signs through migrate when no signer is injected', async () => {
    const prevDir = process.env.STORAGE_DIR;
    const prevSecret = process.env.MCP_DATA_LINK_SECRET;
    const prevBase = process.env.MCP_BASE_URL;
    process.env.STORAGE_DIR = dir;
    process.env.MCP_DATA_LINK_SECRET = TEST_ENV.MCP_DATA_LINK_SECRET;
    process.env.MCP_BASE_URL = TEST_ENV.MCP_BASE_URL;
    resetDataLinkStoreForTests();
    try {
      const attached = await attachDataHandle({ component: 'bar-chart' }, [
        { department: 'Engineering' },
      ]);
      expect(attached.ok).toBe(true);
      if (!attached.ok) return;
      expect(isOpaqueDataUrl(attached.spec.dataUrl ?? '')).toBe(true);
      expect(JSON.stringify(attached.spec)).not.toContain('Engineering');
    } finally {
      resetDataLinkStoreForTests();
      if (prevDir === undefined) delete process.env.STORAGE_DIR;
      else process.env.STORAGE_DIR = prevDir;
      if (prevSecret === undefined) delete process.env.MCP_DATA_LINK_SECRET;
      else process.env.MCP_DATA_LINK_SECRET = prevSecret;
      if (prevBase === undefined) delete process.env.MCP_BASE_URL;
      else process.env.MCP_BASE_URL = prevBase;
    }
  });
});

describe('startWorkspaceServer', () => {
  it('answers tools/list over stdio with the real handler', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const disconnect = startWorkspaceServer(
      { input, output },
      {
        env: TEST_ENV,
        table: parseCsvTable(fs.readFileSync(FIXTURE, 'utf8')),
        store,
      },
    );
    try {
      const line = new Promise<Record<string, unknown>>((resolve) => {
        output.once('data', (chunk: Buffer) => resolve(JSON.parse(chunk.toString('utf8'))));
      });
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
      const response = await line;
      const tools = (response.result as { tools: Array<{ name: string }> }).tools;
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe(SHOW_WORKSPACE_NAME);
    } finally {
      disconnect();
    }
  });

  it('resolves tsx/cli the same way the bin trampoline does', () => {
    const require = createRequire(
      fileURLToPath(new URL('../bin/ui9000-workspace-server.mjs', import.meta.url)),
    );
    expect(require.resolve('tsx/cli')).toMatch(/tsx/);
  });
});
