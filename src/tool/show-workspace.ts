import { decide } from '../engine/decide.js';
import type { CatalogEntry, EngineCatalog } from '../spec/engine-catalog.js';
import type { DataProfile } from '../spec/data-profile.js';
import { INTENTS, type Intent } from '../spec/intent.js';
import type { WorkspaceSpec } from '../spec/workspace-spec.js';
import { validateSpec } from '../validate/validate-spec.js';
import { profileColumns } from '../profiler/profile-columns.js';
import { classifyColumns, type ClassifiedColumn } from '../profiler/roles.js';
import { tableToRows, type Table } from '../profiler/table.js';
import { attachDataHandle, type SignDataLink } from './data-channel.js';
import {
  datasetPersistPayload,
  idFromDataUrl,
  INGEST_KEYS,
  resolveWorkspaceIngest,
  type IngestOptions,
  type StoredDataset,
} from './ingest-table.js';
import { chartTypeForComponent, workspaceWidgetPayload } from './widget-payload.js';

export const SHOW_WORKSPACE_NAME = 'show_workspace';

const ARG_ROW_KEYS = ['data', 'points', 'series', 'rows'] as const;

export const SHOW_WORKSPACE_CODES = [
  'invalid_args',
  'rows_in_args',
  'invalid_ingest',
  'dataset_not_found',
  'unknown_intent',
  'missing_context',
  'missing_signer',
  'signer_failed',
  'leaky_handle',
  'missing_binds',
  'no_winner',
  'invalid_spec',
] as const;

export type ShowWorkspaceCode = (typeof SHOW_WORKSPACE_CODES)[number];

export type ShowWorkspaceOk = {
  ok: true;
  spec: WorkspaceSpec;
  summary: string;
  /** FuseDash chartType for the hosted MCP App. Absent when the View cannot render. */
  chartType?: string;
  /** Opaque id for the ingested table. Pass it on the next intent instead of csv. */
  datasetId?: string;
  rowCount?: number;
  columns?: string[];
};

export type ShowWorkspaceFail = {
  ok: false;
  code: ShowWorkspaceCode;
  reason: string;
};

export type ShowWorkspaceResult = ShowWorkspaceOk | ShowWorkspaceFail;

export type ShowWorkspaceContext = {
  catalog: EngineCatalog;
  profile: DataProfile;
  /** Dataset payload for the handle. Never copied into the MCP result. */
  payload?: unknown;
  /** Column names / control labels — not row objects. Used to satisfy catalog dataRoles. */
  fields?: readonly string[];
  /**
   * Profiler classification. When set, binds map catalog roles to those columns
   * (category→team, metric→incidents) instead of CSV order.
   */
  classified?: readonly ClassifiedColumn[];
  /**
   * Tests inject a stub. Production omits this so `attachDataHandle` calls
   * migrate `signDataLink`. A non-function value is `missing_signer`.
   */
  signDataLink?: SignDataLink;
  /** Hosted/production: csv + datasetId only. */
  allowRemoteSources?: boolean;
  maxBytes?: number;
  cwd?: string;
  fetchImpl?: IngestOptions['fetchImpl'];
  loadDataset?: (id: string) => StoredDataset | undefined | Promise<StoredDataset | undefined>;
  /** Stdio session: keep the last ingested table for later `{ intent }` calls. */
  rememberTable?: (table: Table) => void;
};

export const SHOW_WORKSPACE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent'],
  properties: {
    intent: {
      type: 'string',
      enum: [...INTENTS],
      description:
        'Closed objective. One of spatial, comparison, summary, form, evidence, graph. Do not invent values.',
    },
    csv: {
      type: 'string',
      description:
        'Pasted CSV including the header row. Use this when the user attached or pasted a table. Empty string means omit.',
    },
    url: {
      type: 'string',
      description:
        'http(s) URL to a CSV. Local/dev only — rejected on hosted/production. Empty string means omit.',
    },
    path: {
      type: 'string',
      description:
        'Local CSV path (absolute, or relative to cwd). Local/dev only. Empty string means omit.',
    },
    datasetId: {
      type: 'string',
      description:
        'Id returned by an earlier show_workspace on this table. Use instead of csv/url/path.',
    },
  },
} as const;

/**
 * ~2–3 KB. Lists intents, not the 20 engine component ids.
 * The model may send a CSV source; it must not send chart `data[]` rows.
 */
export const SHOW_WORKSPACE_DESCRIPTION = [
  'show_workspace renders one workspace for a tabular dataset.',
  'Call this tool once per user question. It is the only visualization tool.',
  'You do not choose a chart type, widget id, or catalog component. Do not call generate_*.',
  '',
  'intent is required. Optional source — exactly one of csv, url, path, or datasetId.',
  'csv — paste the user table including the header (chat attachments / pasted CSV).',
  'url — http(s) CSV, local/dev only. path — local CSV file, local/dev only.',
  'Hosted/production accepts csv or datasetId only. url and path are rejected there.',
  'datasetId — reuse a table from an earlier call on this server. Keep that id.',
  'Never pass data, rows, points, or series arrays. Those keys are refused.',
  'If the user gave a table this turn, pass csv (or path/url). Omit the source to reuse',
  'the last loaded table, else the shipped demo CSV. Do not echo table cells after the tool returns.',
  '',
  'intent is a closed enum. Use exactly one of the following values.',
  '',
  'spatial — geography: points, regions, choropleth, lat/lng, country, state, city.',
  'Use spatial when the question is where, which region, which country, or a map join.',
  'The engine may pick a map only when the profile has geo fields and a map token.',
  '',
  'comparison — groups versus a metric: category cardinality, rankings, distributions.',
  'Use comparison when the question is which group is highest, lowest, or how values spread.',
  '',
  'summary — headlines and KPIs for a small set of numeric facts.',
  'Use summary when the user wants a snapshot, total, count, or a few headline numbers.',
  '',
  'form — labelled controls the user should fill in: text, number, select, dates, submit.',
  'Use form when the user must enter or confirm values, not when they only want a chart.',
  '',
  'evidence — claims, sources, entity detail, timelines of supporting facts.',
  'graph — nodes and links, how things connect, not where they sit on a map.',
  '',
  'Output is { spec, summary, datasetId, rowCount, columns }. No row objects.',
  'spec.component is chosen by decide() on the server. spec.dataUrl is a signed widget handle.',
  'Keep datasetId and pass it with the next intent instead of pasting csv again.',
  'If intent is missing or not in the enum, the tool refuses.',
  'If no catalog component is eligible, the tool refuses with a written reason.',
  'Retry only with a different intent or a different source. Do not invent a 7th intent.',
].join('\n');

export const SHOW_WORKSPACE_TOOL = {
  name: SHOW_WORKSPACE_NAME,
  description: SHOW_WORKSPACE_DESCRIPTION,
  inputSchema: SHOW_WORKSPACE_INPUT_SCHEMA,
};

export async function handleShowWorkspace(
  args: unknown,
  context: ShowWorkspaceContext,
): Promise<ShowWorkspaceResult> {
  const parsed = parseArgs(args);
  if (!parsed.ok) return parsed;

  if (!context || !Array.isArray(context.catalog) || context.profile == null) {
    return fail(
      'missing_context',
      'show_workspace requires a catalog and profile from the server, not from tool arguments.',
    );
  }
  if (context.signDataLink !== undefined && typeof context.signDataLink !== 'function') {
    return fail(
      'missing_signer',
      'show_workspace needs signDataLink to issue a data handle.',
    );
  }

  const ingested = await resolveWorkspaceIngest(parsed.raw, {
    allowRemoteSources: context.allowRemoteSources,
    maxBytes: context.maxBytes,
    cwd: context.cwd,
    fetchImpl: context.fetchImpl,
    loadDataset: context.loadDataset,
  });
  if (ingested.ok === false) {
    return fail(ingested.code, ingested.reason);
  }

  let runtime = context;
  let datasetId: string | undefined;
  if (ingested.ok && !('skip' in ingested)) {
    context.rememberTable?.(ingested.table);
    runtime = contextFromTable(ingested.table, context);
    datasetId = ingested.datasetId;
    if (!datasetId && context.signDataLink) {
      try {
        const stored = await context.signDataLink(
          datasetPersistPayload(ingested.label, ingested.table),
        );
        datasetId = idFromDataUrl(stored.dataUrl);
      } catch {
        datasetId = undefined;
      }
    }
  }

  const decision = decide({
    intent: parsed.intent,
    profile: runtime.profile,
    catalog: runtime.catalog,
  });
  if (!decision.winner) {
    const reason = decision.rejected[0]?.reason ?? decision.trace.tieBreak;
    return fail('no_winner', reason || 'No eligible catalog component for this intent and profile.');
  }

  const winner = runtime.catalog.find((item) => item.id === decision.winner);
  const shaped = shapeSpec(
    {
      component: decision.winner,
      allowedActions: decision.trace.actions,
    },
    winner,
    runtime.fields,
    runtime.classified,
  );
  if (!shaped.ok) return shaped;

  const chartType = chartTypeForComponent(decision.winner, winner?.chartTypeKeys);
  const payload = workspaceWidgetPayload(
    decision.winner,
    chartType,
    shaped.spec.binds,
    runtime.payload,
  );

  let spec: WorkspaceSpec;
  try {
    const attached = await attachDataHandle(
      shaped.spec,
      payload,
      runtime.signDataLink,
    );
    if (!attached.ok) {
      return fail(
        attached.code === 'leaky_handle' ? 'leaky_handle' : 'signer_failed',
        attached.reason,
      );
    }
    spec = attached.spec;
  } catch {
    return fail('signer_failed', 'signDataLink threw before returning a handle.');
  }

  const validated = validateSpec(spec, runtime.catalog);
  if (!validated.ok) {
    return fail('invalid_spec', validated.reason);
  }

  const columns = runtime.fields?.filter((name) => name.trim().length > 0);
  return {
    ok: true,
    spec: validated.spec,
    summary: buildSummary(validated.spec, parsed.intent, decision.winner, decision.trace.tieBreak),
    chartType,
    ...(datasetId ? { datasetId } : {}),
    ...(typeof runtime.profile.rowCount === 'number' ? { rowCount: runtime.profile.rowCount } : {}),
    ...(columns && columns.length > 0 ? { columns: [...columns] } : {}),
  };
}

function contextFromTable(
  table: Table,
  context: ShowWorkspaceContext,
): ShowWorkspaceContext {
  const classified = classifyColumns(table).columns;
  return {
    ...context,
    profile: profileColumns(table, { hasMapToken: true }),
    payload: tableToRows(table),
    fields: table.columns.map((column) => column.name),
    classified,
  };
}

function shapeSpec(
  base: WorkspaceSpec,
  entry: CatalogEntry | undefined,
  fields: readonly string[] | undefined,
  classified?: readonly ClassifiedColumn[],
): { ok: true; spec: WorkspaceSpec } | ShowWorkspaceFail {
  const spec: WorkspaceSpec = { ...base };
  if (entry?.accessibility?.nameFrom) {
    spec.label = entry.id;
  }

  const roles = entry?.dataRoles ?? [];
  const requiredRoles = roles.filter((role) => role.required && role.id !== 'fields');
  const optionalRoles = roles.filter((role) => !role.required && role.id !== 'fields');
  const needsFieldsRole = roles.some((role) => role.required && role.id === 'fields');
  const namesResult = normalizeFieldNames(fields, requiredRoles.map((role) => role.id));
  if (!namesResult.ok) {
    return fail(
      'missing_binds',
      'Catalog field names must be a list of non-empty strings on the server context, not row objects.',
    );
  }
  const names = namesResult.names;

  if (requiredRoles.length > 0 && !classified?.length && names.length < requiredRoles.length) {
    return fail(
      'missing_binds',
      'Catalog required data roles need column names; pass fields on the server context, not in tool arguments.',
    );
  }

  const binds: { role: string; field: string }[] = [];
  for (let index = 0; index < requiredRoles.length; index += 1) {
    const role = requiredRoles[index]!;
    const field = classified?.length
      ? fieldForRole(role.id, classified)
      : (names[index] ?? role.id);
    if (!field) {
      return fail(
        'missing_binds',
        `No column matches catalog role "${role.id}".`,
      );
    }
    binds.push({ role: role.id, field });
  }

  if (classified?.length) {
    const usedRoles = new Set(binds.map((item) => item.role));
    const usedFields = new Set(binds.map((item) => item.field));
    for (const role of optionalRoles) {
      if (usedRoles.has(role.id)) continue;
      const field = fieldForRole(role.id, classified);
      if (!field || usedFields.has(field)) continue;
      binds.push({ role: role.id, field });
      usedFields.add(field);
    }
  }

  if (binds.length > 0) spec.binds = binds;

  if (needsFieldsRole || binds.length > 0) {
    const labels = classified?.length
      ? classified.map((entry) => entry.column.name)
      : names.length > 0
        ? names
        : ['Field'];
    spec.fields = labels.map((name) => ({ name, label: name }));
  }

  return { ok: true, spec };
}

/** Catalog dataRole id → profiler column roles, first match wins. */
const ROLE_COLUMN: Record<string, readonly ClassifiedColumn['role'][]> = {
  category: ['category'],
  metric: ['metric'],
  distribution: ['metric'],
  geo: ['geo'],
  proposal: ['entity', 'claim'],
  claim: ['claim'],
  entity: ['entity'],
  nodes: ['node'],
  links: ['link'],
  events: ['event'],
  sources: ['sources'],
  rows: ['category', 'metric', 'entity', 'geo'],
};

function fieldForRole(
  roleId: string,
  classified: readonly ClassifiedColumn[],
): string | undefined {
  const wanted = ROLE_COLUMN[roleId] ?? [roleId as ClassifiedColumn['role']];
  for (const role of wanted) {
    const hit = classified.find((entry) => entry.role === role);
    if (hit) return hit.column.name;
  }
  return undefined;
}

function normalizeFieldNames(
  fields: readonly unknown[] | undefined,
  fallback: string[],
): { ok: true; names: string[] } | { ok: false } {
  if (fields === undefined) return { ok: true, names: fallback };
  if (!Array.isArray(fields)) return { ok: false };
  const names: string[] = [];
  for (const item of fields) {
    if (typeof item !== 'string') return { ok: false };
    const name = item.trim();
    if (!name) return { ok: false };
    names.push(name);
  }
  return { ok: true, names };
}

function parseArgs(
  args: unknown,
): { ok: true; intent: Intent; raw: Record<string, unknown> } | ShowWorkspaceFail {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return fail('invalid_args', 'show_workspace arguments must be an object.');
  }
  const raw = args as Record<string, unknown>;
  if (ARG_ROW_KEYS.some((key) => key in raw)) {
    return fail(
      'rows_in_args',
      'show_workspace refuses dataset rows in arguments. Pass csv, url, path, or datasetId instead.',
    );
  }
  const allowed = new Set<string>(['intent', ...INGEST_KEYS]);
  const keys = Object.keys(raw);
  if (keys.some((key) => !allowed.has(key))) {
    return fail(
      'invalid_args',
      'show_workspace accepts intent plus optional csv, url, path, or datasetId.',
    );
  }
  for (const key of INGEST_KEYS) {
    if (key in raw && raw[key] !== undefined && typeof raw[key] !== 'string') {
      return fail('invalid_args', `${key} must be a string.`);
    }
  }
  if (typeof raw.intent !== 'string' || !isIntent(raw.intent)) {
    return fail(
      'unknown_intent',
      `intent must be one of ${INTENTS.join(', ')}.`,
    );
  }
  return { ok: true, intent: raw.intent, raw };
}

function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}

function buildSummary(
  spec: WorkspaceSpec,
  intent: Intent,
  winner: string,
  tieBreak: string,
): string {
  const parts = [`${winner} for ${intent}`, tieBreak];
  const binds = formatBinds(spec.binds);
  if (binds) parts.push(binds);
  if (spec.callServerTool) {
    parts.push(`rows via ${spec.callServerTool}`);
  }
  return parts.filter((part) => part.trim().length > 0).join('. ');
}

function formatBinds(binds: WorkspaceSpec['binds']): string | undefined {
  if (!binds) return undefined;
  const items = Array.isArray(binds)
    ? binds.map((item) => `${item.role}=${item.field}`)
    : Object.entries(binds).map(([role, value]) => {
        const field = typeof value === 'string' ? value : value.field;
        return `${role}=${field}`;
      });
  return items.length ? `binds ${items.join(', ')}` : undefined;
}

function fail(code: ShowWorkspaceCode, reason: string): ShowWorkspaceFail {
  return { ok: false, code, reason };
}
