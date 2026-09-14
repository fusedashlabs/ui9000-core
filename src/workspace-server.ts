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
import {
  resolveDataLinkStorageDir,
  signDataLink,
  TtlStore,
} from './migrate/datalink/index.js';
import { profileColumns } from './profiler/profile-columns.js';
import { parseCsvTable, tableRowCount, type Table } from './profiler/table.js';
import {
  connectStdio,
  createServer,
  type McpServer,
  type StdioStreams,
} from './server/index.js';
import {
  SHOW_WORKSPACE_DESCRIPTION,
  SHOW_WORKSPACE_INPUT_SCHEMA,
  handleShowWorkspace,
  type ShowWorkspaceContext,
} from './tool/show-workspace.js';

export const WORKSPACE_DATA_PATH_ENV = 'WORKSPACE_DATA_PATH';

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
};

/** JSON-RPC tool schema. Cloned so the `as const` contract object stays frozen. */
const SHOW_WORKSPACE_LIST_SCHEMA = JSON.parse(
  JSON.stringify(SHOW_WORKSPACE_INPUT_SCHEMA),
) as Record<string, unknown>;

/**
 * Bind catalog + profile into `createServer(handleShowWorkspace)`.
 * The model still only sends `{ intent }`. Rows live on the server and leave as
 * an opaque handle, never as tool arguments or result rows.
 *
 * When `env`/`store` are omitted, `handleShowWorkspace` leaves `signDataLink`
 * unset so `attachDataHandle` calls migrate `signDataLink` (process.env +
 * default TTL store). A host `env` without `store` still uses `env.STORAGE_DIR`,
 * not `process.env` — same bag for secret and files.
 */
export function createWorkspaceServer(
  options: CreateWorkspaceServerOptions = {},
): McpServer {
  const env = options.env ?? process.env;
  const table =
    options.table ??
    loadWorkspaceTable(options.dataPath ?? env[WORKSPACE_DATA_PATH_ENV], options.root);
  const catalog = loadWorkspaceCatalog();
  const profile = profileColumns(table, { hasMapToken: envHasMapToken(env) });
  const payload = tableToRows(table);
  const fields = table.columns.map((column) => column.name);

  const context: ShowWorkspaceContext = {
    catalog,
    profile,
    payload,
    fields,
  };
  const store = resolveBoundStore(env, options);
  if (store !== undefined) {
    context.signDataLink = (rows) => signDataLink(rows, { env, store });
  }

  const handler = (args: unknown) => handleShowWorkspace(args, context);

  return createServer(handler, {
    description: SHOW_WORKSPACE_DESCRIPTION,
    inputSchema: SHOW_WORKSPACE_LIST_SCHEMA,
  });
}

/** Stdio entry used by `yarn workspace @ui9000/core start` and the bin. */
export function startWorkspaceServer(
  streams?: StdioStreams,
  options?: CreateWorkspaceServerOptions,
) {
  return connectStdio(createWorkspaceServer(options), streams);
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

export function tableToRows(table: Table): Record<string, string>[] {
  const rowCount = tableRowCount(table);
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const row: Record<string, string> = {};
    for (const column of table.columns) {
      row[column.name] = column.values[i] ?? '';
    }
    rows.push(row);
  }
  return rows;
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

function envHasMapToken(env: NodeJS.ProcessEnv): boolean {
  const flag = (env.WORKSPACE_HAS_MAP_TOKEN || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  return Boolean((env.MAPBOX_ACCESS_TOKEN || env.MAPBOX_TOKEN || '').trim());
}
