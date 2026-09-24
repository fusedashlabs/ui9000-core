import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
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
  DEFAULT_HOSTED_MCP_BASE_URL,
  REMOTE_PERSIST_ENV,
  WORKSPACE_MAPBOX_TOKEN,
  applyWorkspaceHostDefaults,
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

function parseStdioFrames(chunk: Buffer | string): Array<Record<string, unknown>> {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function rpcOverStdio(
  input: PassThrough,
  output: PassThrough,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = message.id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      output.off('data', onData);
      reject(new Error(`timed out waiting for stdio id=${String(id)}`));
    }, 5000);
    const onData = (chunk: Buffer) => {
      for (const frame of parseStdioFrames(chunk)) {
        if (frame.id === id) {
          clearTimeout(timer);
          output.off('data', onData);
          resolve(frame);
          return;
        }
      }
    };
    output.on('data', onData);
    input.write(`${JSON.stringify(message)}\n`);
  });
}

async function initializeSdkStdio(input: PassThrough, output: PassThrough): Promise<void> {
  const init = await rpcOverStdio(input, output, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'workspace-server-test', version: '0.0.0' },
    },
  });
  expect(init.error).toBeUndefined();
  input.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
  );
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
    expect(typeof applyWorkspaceHostDefaults).toBe('function');
    expect(WORKSPACE_MAPBOX_TOKEN.startsWith('pk.')).toBe(true);
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
    expect(tools[0]?._meta).toMatchObject({
      ui: { resourceUri: 'ui://ui9000/chart' },
      'ui/resourceUri': 'ui://ui9000/chart',
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
      spec?: { component?: string; dataUrl?: string; binds?: unknown };
      summary?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.spec?.component).toBe('bar-chart');
    expect(body.spec?.binds).toEqual([
      { role: 'category', field: 'department' },
      { role: 'metric', field: 'revenue' },
    ]);
    expect(isOpaqueDataUrl(body.spec!.dataUrl!)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Engineering');
    expect(JSON.stringify(result)).not.toContain('120.5');

    const payload = readDataLink({ dataUrl: body.spec!.dataUrl! }, { env: TEST_ENV, store });
    expect(payload).toEqual({
      chartType: 'barChart',
      name: 'bar-chart',
      orientation: 'vertical',
      xAxe: ['department'],
      yAxe: ['revenue'],
      data: [
        { department: 'Engineering', revenue: 120.5 },
        { department: 'Support', revenue: 98.2 },
        { department: 'Sales', revenue: 143.9 },
        { department: 'Design', revenue: 77.4 },
      ],
    });
    expect(result._meta).toMatchObject({
      ui: { resourceUri: 'ui://ui9000/chart' },
      chartType: 'barChart',
    });
    expect(String((result.content as Array<{ text?: string }>)[0]?.text)).toContain('ui9000-meta:');
    expect(String((result.content as Array<{ text?: string }>)[0]?.text)).toContain('bar-chart for comparison');
    expect(String((result.content as Array<{ text?: string }>)[0]?.text)).toContain(
      'binds category=department, metric=revenue',
    );
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

  it('charts a pasted csv instead of the fixture table', async () => {
    const server = wiredServer();
    const result = resultOf(
      await server.handle(
        request('tools/call', {
          name: SHOW_WORKSPACE_NAME,
          arguments: {
            intent: 'comparison',
            csv: 'team,count\nNorth,4\nSouth,9\nEast,1\n',
          },
        }),
      ),
    );
    const body = result.structuredContent as {
      ok: boolean;
      spec?: { binds?: Array<{ role: string; field: string }> };
      datasetId?: string;
      columns?: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.spec?.binds).toEqual([
      { role: 'category', field: 'team' },
      { role: 'metric', field: 'count' },
    ]);
    expect(body.columns).toEqual(['team', 'count']);
    expect(body.datasetId).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain('North');
    expect(JSON.stringify(result)).not.toContain('Engineering');
  });

  it('reuses an ingested table on the next intent-only call', async () => {
    const server = wiredServer();
    await server.handle(
      request('tools/call', {
        name: SHOW_WORKSPACE_NAME,
        arguments: {
          intent: 'comparison',
          csv: 'team,count\nNorth,4\nSouth,9\n',
        },
      }),
    );
    const result = resultOf(
      await server.handle(
        request(
          'tools/call',
          { name: SHOW_WORKSPACE_NAME, arguments: { intent: 'summary' } },
          2,
        ),
      ),
    );
    const body = result.structuredContent as {
      ok: boolean;
      spec?: { component?: string; binds?: Array<{ field: string }> };
    };
    expect(body.ok).toBe(true);
    expect(body.spec?.component).toBe('kpi-widget');
    expect(body.spec?.binds?.some((item) => item.field === 'count')).toBe(true);
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

  it('picks map-chart for spatial without WORKSPACE_HAS_MAP_TOKEN', async () => {
    const geo = fileURLToPath(
      new URL('../tests/fixtures/profiles/geo-lat-lng.csv', import.meta.url),
    );
    const server = createWorkspaceServer({
      env: TEST_ENV,
      table: parseCsvTable(fs.readFileSync(geo, 'utf8')),
      store,
    });
    const result = resultOf(
      await server.handle(
        request('tools/call', { name: SHOW_WORKSPACE_NAME, arguments: { intent: 'spatial' } }),
      ),
    );
    const body = result.structuredContent as {
      ok: boolean;
      spec?: { component?: string; dataUrl?: string; binds?: unknown };
    };
    expect(body.ok).toBe(true);
    expect(body.spec?.component).toBe('map-chart');
    expect(body.spec?.binds).toEqual([
      { role: 'geo', field: 'lat' },
      { role: 'metric', field: 'readings' },
    ]);
    const payload = readDataLink({ dataUrl: body.spec!.dataUrl! }, { env: TEST_ENV, store });
    expect(payload).toEqual({
      chartType: 'mapChart',
      name: 'map-chart',
      layers: [
        {
          name: 'Markers',
          visualisationType: 'markers',
          geospatialData: ['point'],
          arrangeByMetric: ['value'],
          data: [
            { point: [-0.1278, 51.5074], value: 42 },
            { point: [-2.2426, 53.4808], value: 17 },
            { point: [-1.6178, 54.9783], value: 29 },
          ],
        },
      ],
    });
  });

  it('aggregates country ids into a choropleth for spatial', async () => {
    const geo = fileURLToPath(
      new URL('../tests/fixtures/datasets/regional-incidents.csv', import.meta.url),
    );
    const server = createWorkspaceServer({
      env: TEST_ENV,
      table: parseCsvTable(fs.readFileSync(geo, 'utf8')),
      store,
    });
    const result = resultOf(
      await server.handle(
        request('tools/call', { name: SHOW_WORKSPACE_NAME, arguments: { intent: 'spatial' } }),
      ),
    );
    const body = result.structuredContent as {
      ok: boolean;
      spec?: { component?: string; dataUrl?: string; binds?: unknown };
    };
    expect(body.ok).toBe(true);
    expect(body.spec?.component).toBe('map-chart');
    expect(body.spec?.binds).toEqual([
      { role: 'geo', field: 'country' },
      { role: 'metric', field: 'incidents' },
    ]);
    const payload = readDataLink({ dataUrl: body.spec!.dataUrl! }, { env: TEST_ENV, store });
    expect(payload).toMatchObject({
      chartType: 'mapChart',
      data: expect.arrayContaining([
        { label: 'France', value: 37 },
        { label: 'Germany', value: 27 },
      ]),
    });
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
    expect(payload).toMatchObject({
      chartType: 'barChart',
      xAxe: ['department'],
      yAxe: ['revenue'],
      data: expect.arrayContaining([
        expect.objectContaining({ department: 'Engineering', revenue: 120.5 }),
      ]),
    });
    expect(fs.readdirSync(dir).some((name) => name.endsWith('.json'))).toBe(true);
  });

  it('serves the hosted MCP App HTML on resources/read', async () => {
    const html = '<!doctype html><html><body>ui9000-chart</body></html>';
    const server = createWorkspaceServer({
      env: TEST_ENV,
      table: parseCsvTable(fs.readFileSync(FIXTURE, 'utf8')),
      store,
      loadChartHtml: () => html,
    });
    const listed = resultOf(await server.handle(request('resources/list')));
    expect(listed.resources).toEqual([
      expect.objectContaining({
        uri: 'ui://ui9000/chart',
        mimeType: 'text/html;profile=mcp-app',
      }),
    ]);
    const read = resultOf(
      await server.handle(request('resources/read', { uri: 'ui://ui9000/chart' })),
    );
    expect(read.contents).toEqual([
      expect.objectContaining({
        uri: 'ui://ui9000/chart',
        mimeType: 'text/html;profile=mcp-app',
        text: html,
      }),
    ]);
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

describe('applyWorkspaceHostDefaults', () => {
  it('fills hosted origin, remote persist, and the baked Mapbox token without mutating input', () => {
    const input: NodeJS.ProcessEnv = {};
    const next = applyWorkspaceHostDefaults(input);
    expect(input.MCP_BASE_URL).toBeUndefined();
    expect(next.MCP_BASE_URL).toBe(DEFAULT_HOSTED_MCP_BASE_URL);
    expect(next[REMOTE_PERSIST_ENV]).toBe('1');
    expect(next.MAPBOX_ACCESS_TOKEN).toBe(WORKSPACE_MAPBOX_TOKEN);
  });

  it('does not enable remote persist for a loopback MCP_BASE_URL', () => {
    const next = applyWorkspaceHostDefaults({ MCP_BASE_URL: 'http://127.0.0.1:8088' });
    expect(next.MCP_BASE_URL).toBe('http://127.0.0.1:8088');
    expect(next[REMOTE_PERSIST_ENV]).toBeUndefined();
    expect(next.MAPBOX_ACCESS_TOKEN).toBe(WORKSPACE_MAPBOX_TOKEN);
  });

  it('keeps an explicit Mapbox token and hosted origin', () => {
    const next = applyWorkspaceHostDefaults({
      MCP_BASE_URL: 'https://mcp.ui9000.com',
      MAPBOX_ACCESS_TOKEN: 'pk.override',
    });
    expect(next.MCP_BASE_URL).toBe('https://mcp.ui9000.com');
    expect(next[REMOTE_PERSIST_ENV]).toBe('1');
    expect(next.MAPBOX_ACCESS_TOKEN).toBe('pk.override');
  });
});

describe('startWorkspaceServer', () => {
  it('answers tools/list over SDK stdio with the real handler', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const disconnect = await startWorkspaceServer(
      { input, output },
      {
        env: TEST_ENV,
        table: parseCsvTable(fs.readFileSync(FIXTURE, 'utf8')),
        store,
      },
    );
    try {
      await initializeSdkStdio(input, output);
      const response = await rpcOverStdio(input, output, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });
      const tools = (response.result as { tools: Array<{ name: string }> }).tools;
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe(SHOW_WORKSPACE_NAME);
    } finally {
      disconnect();
    }
  });

  it('answers tools/list with no mcp.json env', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const disconnect = await startWorkspaceServer(
      { input, output },
      {
        env: {},
        table: parseCsvTable(fs.readFileSync(FIXTURE, 'utf8')),
        store,
      },
    );
    try {
      await initializeSdkStdio(input, output);
      const response = await rpcOverStdio(input, output, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });
      const tools = (response.result as { tools: Array<{ name: string }> }).tools;
      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe(SHOW_WORKSPACE_NAME);
    } finally {
      disconnect();
    }
  });

  it('resolves tsx/cli and the widgets catalog the same way the bin trampoline does', () => {
    const require = createRequire(
      fileURLToPath(new URL('../bin/ui9000-workspace-server.mjs', import.meta.url)),
    );
    expect(require.resolve('tsx/cli')).toMatch(/tsx/);
    const catalog = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { fileURLToPath } from 'node:url'; process.stdout.write(fileURLToPath(import.meta.resolve('@fusedashlabs/widgets/catalog')));",
      ],
      { encoding: 'utf8', cwd: fileURLToPath(new URL('../../..', import.meta.url)) },
    );
    expect(catalog).toMatch(/catalog/);
  });
});
