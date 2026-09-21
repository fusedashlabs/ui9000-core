/**
 * Same ingest surface as mcp-ui `load_dataset`: csv | url | path | datasetId.
 * Rows stay on the server. The MCP result only gets datasetId + column names.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  parseCsvTable,
  tableRowCount,
  tableToRows,
  type Table,
} from '../profiler/table.js';

export const DATASET_KIND = 'dataset' as const;

export const INGEST_KEYS = ['csv', 'url', 'path', 'datasetId'] as const;

export type IngestKey = (typeof INGEST_KEYS)[number];

export type StoredDataset = {
  name?: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

export type IngestOptions = {
  /** Hosted/production: csv + datasetId only (no SSRF / no container file read). */
  allowRemoteSources?: boolean;
  maxBytes?: number;
  cwd?: string;
  fetchImpl?: (
    input: string,
    init?: { method?: string },
  ) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;
  loadDataset?: (id: string) => StoredDataset | undefined | Promise<StoredDataset | undefined>;
};

export type IngestFail = {
  ok: false;
  code: 'invalid_ingest' | 'dataset_not_found';
  reason: string;
};

export type IngestOk = {
  ok: true;
  table: Table;
  rows: Record<string, string>[];
  label: string;
  datasetId?: string;
};

export type IngestResult = IngestOk | IngestFail | { ok: true; skip: true };

const DEFAULT_MAX_BYTES = 1.5 * 1024 * 1024;

const REMOTE_SOURCE_DISABLED =
  'url and path dataset sources are disabled on hosted/production servers. Paste CSV via the csv field.';

const SENSITIVE_PATH = 'path cannot be a hidden, env, or secrets file.';

export function isSensitiveDatasetFileName(fileName: string): boolean {
  const base = path.basename(fileName).toLowerCase();
  if (base.startsWith('.')) return true;
  return base === 'env.prod' || base === 'env.local';
}

export function isDatasetPayload(value: unknown): value is {
  config: { kind: typeof DATASET_KIND; name?: string };
  data: { columns: string[]; rows: Record<string, unknown>[] };
} {
  if (!value || typeof value !== 'object') return false;
  const root = value as {
    config?: { kind?: unknown; name?: unknown };
    data?: { columns?: unknown; rows?: unknown };
  };
  return (
    root.config?.kind === DATASET_KIND &&
    Array.isArray(root.data?.columns) &&
    Array.isArray(root.data?.rows)
  );
}

export function datasetFromPayload(payload: unknown): StoredDataset | undefined {
  if (!isDatasetPayload(payload)) return undefined;
  return {
    name: typeof payload.config.name === 'string' ? payload.config.name : undefined,
    columns: payload.data.columns.filter((name): name is string => typeof name === 'string'),
    rows: payload.data.rows.filter(
      (row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row),
    ),
  };
}

export function datasetPersistPayload(label: string, table: Table): unknown {
  return {
    config: { kind: DATASET_KIND, name: label },
    data: {
      columns: table.columns.map((column) => column.name),
      rows: tableToRows(table),
    },
  };
}

export function idFromDataUrl(dataUrl: string): string | undefined {
  try {
    const parts = new URL(dataUrl).pathname.split('/').filter(Boolean);
    const id = parts[parts.length - 1];
    return id || undefined;
  } catch {
    return undefined;
  }
}

export function tableFromRecords(records: readonly Record<string, unknown>[]): Table {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        names.push(key);
      }
    }
  }
  const columns = names.map((name) => ({
    name,
    values: records.map((record) => stringifyCell(record[name])),
  }));
  return { columns };
}

export function tableFromStoredDataset(dataset: StoredDataset): Table {
  if (dataset.columns.length > 0) {
    const columns = dataset.columns.map((name) => ({
      name,
      values: dataset.rows.map((row) => stringifyCell(row[name])),
    }));
    return { columns };
  }
  return tableFromRecords(dataset.rows);
}

function stringifyCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function fail(code: IngestFail['code'], reason: string): IngestFail {
  return { ok: false, code, reason };
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const next = value.trim();
  return next.length > 0 ? next : undefined;
}

/**
 * Resolve a user table for this tool call. `{ skip: true }` means use the
 * server's current table (demo / last ingest / WORKSPACE_DATA_PATH).
 */
export async function resolveWorkspaceIngest(
  args: Record<string, unknown>,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const csv = trimmed(args.csv);
  const url = trimmed(args.url);
  const filePath = trimmed(args.path);
  const datasetId = trimmed(args.datasetId);

  const sources = [csv, url, filePath, datasetId].filter(Boolean).length;
  if (sources === 0) return { ok: true, skip: true };
  if (sources > 1) {
    return fail(
      'invalid_ingest',
      'Provide exactly one of: csv, url, path, or datasetId.',
    );
  }

  if (datasetId) {
    if (!options.loadDataset) {
      return fail('dataset_not_found', `Dataset not found or expired (datasetId=${datasetId}).`);
    }
    const stored = await options.loadDataset(datasetId);
    if (!stored) {
      return fail(
        'dataset_not_found',
        `Dataset not found or expired (datasetId=${datasetId}). Pass csv again to reload.`,
      );
    }
    const table = tableFromStoredDataset(stored);
    if (tableRowCount(table) < 1 || table.columns.length < 1) {
      return fail('invalid_ingest', 'datasetId resolved to a table with no columns or rows.');
    }
    return {
      ok: true,
      table,
      rows: tableToRows(table),
      label: stored.name || datasetId,
      datasetId,
    };
  }

  const loaded = await resolveCsvText(
    { csv, url, path: filePath },
    options,
  );
  if (!loaded.ok) return loaded;
  const table = parseCsvTable(loaded.csvText);
  if (table.columns.length < 1 || tableRowCount(table) < 1) {
    return fail('invalid_ingest', 'CSV must include a header row and at least one data row.');
  }
  return {
    ok: true,
    table,
    rows: tableToRows(table),
    label: loaded.label,
  };
}

async function resolveCsvText(
  source: { csv?: string; url?: string; path?: string },
  options: IngestOptions,
): Promise<{ ok: true; csvText: string; label: string } | IngestFail> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowRemote = options.allowRemoteSources !== false;

  if (source.csv) {
    return capCsv(source.csv, 'pasted-csv', maxBytes);
  }

  if (source.url) {
    if (!allowRemote) return fail('invalid_ingest', REMOTE_SOURCE_DISABLED);
    if (!/^https?:\/\//i.test(source.url)) {
      return fail('invalid_ingest', 'url must start with http:// or https://.');
    }
    try {
      const fetchImpl = options.fetchImpl ?? fetch;
      const res = await fetchImpl(source.url);
      if (!res.ok) {
        return fail('invalid_ingest', `Failed to fetch url (HTTP ${res.status}).`);
      }
      const csvText = await res.text();
      return capCsv(csvText, source.url, maxBytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail('invalid_ingest', `Failed to fetch url: ${message}`);
    }
  }

  if (source.path) {
    if (!allowRemote) return fail('invalid_ingest', REMOTE_SOURCE_DISABLED);
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const resolved = path.isAbsolute(source.path)
      ? path.resolve(source.path)
      : path.resolve(cwd, source.path);
    const relative = !path.isAbsolute(source.path);
    if (relative && resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
      return fail('invalid_ingest', 'Relative path must stay inside the working directory.');
    }
    if (isSensitiveDatasetFileName(resolved)) {
      return fail('invalid_ingest', SENSITIVE_PATH);
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return fail('invalid_ingest', `File not found: ${source.path}`);
    }
    const csvText = fs.readFileSync(resolved, 'utf8');
    return capCsv(csvText, path.basename(resolved), maxBytes);
  }

  return fail('invalid_ingest', 'Provide exactly one of: csv, url, path, or datasetId.');
}

function capCsv(
  csvText: string,
  label: string,
  maxBytes: number,
): { ok: true; csvText: string; label: string } | IngestFail {
  const bytes = Buffer.byteLength(csvText, 'utf8');
  if (bytes > maxBytes) {
    return fail(
      'invalid_ingest',
      `CSV is too large (${bytes} bytes). Maximum is ${maxBytes} bytes.`,
    );
  }
  if (!csvText.trim()) {
    return fail('invalid_ingest', 'CSV is empty.');
  }
  return { ok: true, csvText, label };
}
