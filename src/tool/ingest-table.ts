/**
 * Same ingest surface as mcp-ui `load_dataset`: csv | url | path | datasetId.
 * Rows stay on the server. The MCP result only gets datasetId + column names.
 */

import { lookup } from 'node:dns/promises';
import * as fs from 'node:fs';
import { isIP } from 'node:net';
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
    init?: { method?: string; redirect?: 'error' | 'follow' | 'manual' },
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

const SENSITIVE_BASES = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  'secrets',
  'secrets.json',
  'env.prod',
  'env.local',
]);

const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube']);

/** Hidden files, key material, and well-known secret directories. Checks the whole path, not only the basename. */
export function isSensitiveDatasetFileName(fileName: string): boolean {
  const parts = fileName.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
  if (parts.some((part) => SENSITIVE_DIRS.has(part))) return true;
  const base = parts[parts.length - 1] ?? '';
  if (base.startsWith('.') && base !== '.' && base !== '..') return true;
  if (base.endsWith('.pem') || base.endsWith('.key')) return true;
  return SENSITIVE_BASES.has(base);
}

/** System trees a chart table must not read, even when the basename looks harmless. */
export function isSensitiveDatasetPath(filePath: string): boolean {
  if (isSensitiveDatasetFileName(filePath)) return true;
  const norm = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return ['/etc/', '/proc/', '/sys/', '/private/etc/'].some(
    (prefix) => norm === prefix.slice(0, -1) || norm.startsWith(prefix),
  );
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
    const blocked = await blockedDatasetUrl(source.url);
    if (blocked) return fail('invalid_ingest', blocked);
    try {
      const fetchImpl = options.fetchImpl ?? fetch;
      const res = await fetchImpl(source.url, { method: 'GET', redirect: 'error' });
      if (res.status >= 300 && res.status < 400) {
        return fail('invalid_ingest', 'url redirects are refused.');
      }
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
    let real: string;
    let realCwd: string;
    try {
      real = fs.realpathSync(resolved);
      realCwd = fs.realpathSync(cwd);
    } catch {
      return fail('invalid_ingest', `File not found: ${source.path}`);
    }
    if (relative && real !== realCwd && !real.startsWith(realCwd + path.sep)) {
      return fail('invalid_ingest', 'Relative path must stay inside the working directory.');
    }
    if (isSensitiveDatasetPath(real)) {
      return fail('invalid_ingest', SENSITIVE_PATH);
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(real);
    } catch {
      return fail('invalid_ingest', `File not found: ${source.path}`);
    }
    if (!stat.isFile()) {
      return fail('invalid_ingest', `File not found: ${source.path}`);
    }
    const csvText = fs.readFileSync(real, 'utf8');
    return capCsv(csvText, path.basename(real), maxBytes);
  }

  return fail('invalid_ingest', 'Provide exactly one of: csv, url, path, or datasetId.');
}

const BLOCKED_URL_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
]);

export type HostLookup = (hostname: string) => Promise<readonly { address: string }[]>;

async function lookupAll(hostname: string): Promise<readonly { address: string }[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

/**
 * Refuse loopback, link-local, private, and cloud-metadata hosts before fetch.
 * A public name is refused when any resolved address is in those ranges.
 */
export async function blockedDatasetUrl(
  raw: string,
  lookupHost: HostLookup = lookupAll,
): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'url is not a valid http(s) URL.';
  }
  if (url.username || url.password) return 'url must not include credentials.';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    BLOCKED_URL_HOSTS.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isBlockedIp(host) ||
    isAmbiguousNumericHost(host)
  ) {
    return 'url host is not allowed.';
  }
  if (isIP(host)) return undefined;
  let records: readonly { address: string }[];
  try {
    records = await lookupHost(host);
  } catch {
    return 'url host could not be resolved.';
  }
  if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
    return 'url host is not allowed.';
  }
  return undefined;
}

/** Integer and short dotted forms (`2130706433`, `127.1`) that isIP() does not classify. */
function isAmbiguousNumericHost(host: string): boolean {
  return /^[\d.]+$/.test(host) && isIP(host) === 0;
}

function isBlockedIp(host: string): boolean {
  const kind = isIP(host);
  if (kind === 4) {
    const [a = -1, b = -1] = host.split('.').map((part) => Number(part));
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (kind === 6) return isBlockedIpv6(host);
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const parts = expandIpv6(host.toLowerCase());
  if (!parts) return true;
  const mapped =
    parts[0] === 0 &&
    parts[1] === 0 &&
    parts[2] === 0 &&
    parts[3] === 0 &&
    parts[4] === 0 &&
    parts[5] === 0xffff;
  if (mapped || parts.slice(0, 6).every((part) => part === 0)) {
    const hi = parts[6] ?? 0;
    const lo = parts[7] ?? 0;
    return isBlockedIp(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  if (parts.every((part) => part === 0)) return true;
  if (parts[7] === 1 && parts.slice(0, 7).every((part) => part === 0)) return true;
  const first = parts[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  return false;
}

function expandIpv6(host: string): number[] | undefined {
  let input = host;
  const dotted = input.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] && dotted[2]) {
    if (isIP(dotted[2]) !== 4) return undefined;
    const [a = 0, b = 0, c = 0, d = 0] = dotted[2].split('.').map((part) => Number(part));
    const hi = ((a << 8) | b).toString(16);
    const lo = ((c << 8) | d).toString(16);
    input = `${dotted[1]}${hi}:${lo}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return undefined;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return undefined;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (groups.length !== 8) return undefined;
  const nums = groups.map((part) => (/^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN));
  if (nums.some((part) => !Number.isFinite(part))) return undefined;
  return nums;
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
