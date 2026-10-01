/**
 * S3-26 wiring: the stdio MCP server with the real `handleShowWorkspace`.
 *
 * Junior modules stay untouched — this file imports `createServer`,
 * `loadWorkspaceCatalog`, `profileColumns`, and `signDataLink`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkspaceCatalog } from './catalog/load-workspace.js';
import { askJev } from './jev/ask.js';
import {
  DEFAULT_BASE_URL,
  enableRemotePersist,
  isProductionLikeEnv,
  isRemoteDataLinkBase,
  resolveDataLinkStorageDir,
  signDataLink,
  TtlStore,
} from './migrate/datalink/index.js';
import { profileColumns } from './profiler/profile-columns.js';
import { classifyColumns } from './profiler/roles.js';
import { parseCsvTable, tableToRows, type Table } from './profiler/table.js';
import {
  createServer,
  type McpServer,
  type ShowWorkspaceHandler,
  type ShowWorkspaceToolInfo,
  type StdioStreams,
} from './server/index.js';
import { connectSdkWorkspace } from './server/sdk-workspace.js';
import type { Disconnect } from './server/stdio.js';
import { workspaceChartAppResource } from './server/mcp-app.js';
import {
  SHOW_WORKSPACE_DESCRIPTION,
  SHOW_WORKSPACE_INPUT_SCHEMA,
  handleShowWorkspace,
  type ShowWorkspaceContext,
} from './tool/show-workspace.js';
import { datasetFromPayload } from './tool/ingest-table.js';

export const WORKSPACE_DATA_PATH_ENV = 'WORKSPACE_DATA_PATH';

/**
 * Same public FuseDash charts key mcp-ui bakes as `MCP_MAPBOX_TOKEN`.
 * Maps always have a token on this server — do not require `WORKSPACE_HAS_MAP_TOKEN`.
 */
export const WORKSPACE_MAPBOX_TOKEN =
  'pk.eyJ1IjoiYW5keWsxOTg3IiwiYSI6ImNqeHJtdGJjNTA5bWwzbW1mcXA0cTZuMmkifQ.qAhmQzT0m6-KuvZt7-C83A';

/**
 * Fill hosted defaults so Cursor/Claude stdio starts with no mcp.json env.
 * Does not mutate the input object.
 */
export function applyWorkspaceHostDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  if (!next.MCP_BASE_URL?.trim()) {
    next.MCP_BASE_URL = DEFAULT_BASE_URL;
  }
  const base = next.MCP_BASE_URL.trim();
  if (isRemoteDataLinkBase(base)) {
    enableRemotePersist(next);
  }
  if (!(next.MAPBOX_ACCESS_TOKEN || next.MAPBOX_TOKEN || '').trim()) {
    next.MAPBOX_ACCESS_TOKEN = WORKSPACE_MAPBOX_TOKEN;
  }
  return next;
}

/** Local `.env` only, and only for a real process start. Does not override a key already set. */
export function readDotEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const file = fileURLToPath(new URL('../.env', import.meta.url));
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return env;
  }
  const next: NodeJS.ProcessEnv = { ...env };
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (next[name]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    next[name] = value;
  }
  return next;
}

/** `packages/core` — relative `WORKSPACE_DATA_PATH` resolves here, not cwd. */
function packageRoot(): string {
  return fileURLToPath(new URL('../', import.meta.url));
}

export type CreateWorkspaceServerOptions = {
  env?: NodeJS.ProcessEnv;
  table?: Table;
  dataPath?: string;
  store?: TtlStore;
  /** Override package root when resolving a relative data path. Tests only. */
  root?: string;
  /** Tests inject hosted App View HTML so resources/read does not hit the network. */
  loadChartHtml?: () => string | Promise<string>;
  /**
   * HTTP forces this off. Stdio local/dev keeps url and path unless the env is
   * production-like.
   */
  allowRemoteSources?: boolean;
};

/** JSON-RPC tool schema. Cloned so the `as const` contract object stays frozen. */
const SHOW_WORKSPACE_LIST_SCHEMA = JSON.parse(
  JSON.stringify(SHOW_WORKSPACE_INPUT_SCHEMA),
) as Record<string, unknown>;

export type WiredWorkspace = {
  handler: ShowWorkspaceHandler;
  info: ShowWorkspaceToolInfo;
};

/** Shipped demo CSV so HTTP/Claude connectors have rows without WORKSPACE_DATA_PATH. */
export function workspaceDemoCsvPath(): string {
  return fileURLToPath(new URL('./demo/regional-incidents.csv', import.meta.url));
}

export function wireWorkspace(options: CreateWorkspaceServerOptions = {}): WiredWorkspace {
  const env = options.env ?? process.env;
  let table =
    options.table ??
    loadWorkspaceTable(options.dataPath ?? env[WORKSPACE_DATA_PATH_ENV], options.root);
  let selectedColumns: readonly string[] | undefined;
  const catalog = loadWorkspaceCatalog();
  const store = resolveBoundStore(env, options);
  const sign: ShowWorkspaceContext['signDataLink'] = (rows) =>
    signDataLink(rows, store !== undefined ? { env, store } : { env });

  const apiKey = env.TYPESAFE_API_KEY?.trim() ?? '';
  const makeContext = (): ShowWorkspaceContext => {
    const profile = profileColumns(table, { hasMapToken: true });
    const payload = tableToRows(table);
    const fields = table.columns.map((column) => column.name);
    const classified = classifyColumns(table).columns;
    return {
      catalog,
      profile,
      payload,
      fields,
      classified,
      ...(apiKey ? { askJev: (request) => askJev(request, apiKey) } : {}),
      signDataLink: sign,
      allowRemoteSources: options.allowRemoteSources ?? !isProductionLikeEnv(env),
      loadDataset: (id) => {
        if (!store) return undefined;
        return datasetFromPayload(store.get(id)?.payload);
      },
      selectedColumns,
      rememberTable: (next) => {
        table = next;
      },
      rememberColumns: (names) => {
        selectedColumns = names ? [...names] : undefined;
      },
    };
  };

  return {
    handler: (args) => handleShowWorkspace(args, makeContext()),
    info: {
      description: SHOW_WORKSPACE_DESCRIPTION,
      inputSchema: SHOW_WORKSPACE_LIST_SCHEMA,
      appResource: workspaceChartAppResource(
        env.MCP_BASE_URL || DEFAULT_BASE_URL,
        options.loadChartHtml,
      ),
    },
  };
}

/**
 * Bind catalog + profile into `createServer(handleShowWorkspace)`.
 * The model still only sends `{ intent }`. Rows live on the server and leave as
 * an opaque handle, never as tool arguments or result rows.
 *
 * Stdio (`startWorkspaceServer`) applies hosted defaults: `MCP_BASE_URL`
 * → `https://mcp.ui9000.com`, Mapbox token always present, remote persist on.
 * A host `env` without `store` still uses `env.STORAGE_DIR`, not `process.env`.
 *
 * `createWorkspaceServer` stays on the hand-rolled JSON-RPC handle() used by
 * in-process tests. Live stdio (bin / injected streams) always uses the SDK.
 */
export function createWorkspaceServer(
  options: CreateWorkspaceServerOptions = {},
): McpServer {
  const wired = wireWorkspace(options);
  return createServer(wired.handler, wired.info);
}

/**
 * Stdio entry used by `yarn workspace @fusedashlabs/ui9000-workspace start` and the bin.
 * Always MCP SDK + ext-apps so Cursor issues `resources/read` — including when
 * tests inject streams.
 */
export async function startWorkspaceServer(
  streams?: StdioStreams,
  options?: CreateWorkspaceServerOptions,
): Promise<Disconnect> {
  const env = applyWorkspaceHostDefaults(options?.env ?? readDotEnv(process.env));
  const dataPath =
    options?.table || options?.dataPath
      ? options.dataPath
      : resolveWorkspaceDataPath(env[WORKSPACE_DATA_PATH_ENV], options?.root) ??
        workspaceDemoCsvPath();
  const wired = wireWorkspace({ ...options, env, dataPath });
  return connectSdkWorkspace(wired.handler, wired.info, streams);
}

/**
 * Absolute paths are kept. Relative paths resolve against `packages/core`,
 * same as `STORAGE_DIR` — Cursor/Claude stdio often have cwd=$HOME.
 */
export function resolveWorkspaceDataPath(
  raw: string | undefined,
  root: string = packageRoot(),
): string | undefined {
  if (raw == null || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(root, trimmed);
}

export function loadWorkspaceTable(
  dataPath: string | undefined,
  root: string = packageRoot(),
): Table {
  const resolved = resolveWorkspaceDataPath(dataPath, root);
  if (!resolved) return { columns: [] };
  return parseCsvTable(fs.readFileSync(resolved, 'utf8'));
}

function resolveBoundStore(
  env: NodeJS.ProcessEnv,
  options: CreateWorkspaceServerOptions,
): TtlStore | undefined {
  if (options.store !== undefined) return options.store;
  if (options.env !== undefined) {
    return new TtlStore(undefined, resolveDataLinkStorageDir(env));
  }
  return undefined;
}

