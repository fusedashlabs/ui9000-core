import { randomUUID } from 'node:crypto';

import { catalogTierOf, collectPortMetadata } from '@fusedashlabs/widgets/catalog';

import { decide } from '../engine/decide.js';
import { governTrace } from '../governance/govern-trace.js';
import type { CatalogEntry, EngineCatalog } from '../spec/engine-catalog.js';
import type { DataProfile } from '../spec/data-profile.js';
import { INTENTS, type Intent } from '../spec/intent.js';
import { SPEC_ACTION_SET, type WorkspaceSpec } from '../spec/workspace-spec.js';
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
  tableFromRecords,
  type IngestOptions,
  type StoredDataset,
} from './ingest-table.js';
import { chartTypeForComponent, workspaceWidgetPayload } from './widget-payload.js';
import { statusGaugeFits } from './payload/status-gauge-widget.js';
import { shapeSpec } from './shape-spec.js';
import { assertTraceHasNoRows, closedProfile, type Trace, type TraceProposal } from '../trace/trace.js';
import { CHART_ROLES } from '../catalog/chart-roles.js';
import { chartWhyFor, discussChart } from '../catalog/discuss-chart.js';

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
  awaitingUser?: undefined;
  spec: WorkspaceSpec;
  summary: string;
  /** Why this chart fits the columns. The model should say it to the user. */
  chartWhy?: string;
  /** FuseDash chartType for the hosted MCP App. Absent when the View cannot render. */
  chartType?: string;
  /** Opaque id for the ingested table. Pass it on the next intent instead of csv. */
  datasetId?: string;
  rowCount?: number;
  columns?: string[];
  trace: Trace;
  traceId: string;
  /** Present only when a catalog action is held. A preview, not an execution. */
  proposal?: TraceProposal;
};

export type ShowWorkspaceFail = {
  ok: false;
  code: ShowWorkspaceCode;
  reason: string;
};

/**
 * Data was classified and the requested chart does not get drawn.
 * The model shows `message` and waits. The next call carries the user's answer.
 */
export type ShowWorkspaceAwaiting = {
  ok: true;
  awaitingUser: true;
  message: string;
  dataFamilies: readonly string[];
  proposedChart?: string;
  proposedWhy: string;
  requestedChart?: string;
  datasetId?: string;
  rowCount?: number;
  columns?: string[];
};

export type ShowWorkspaceResult = ShowWorkspaceOk | ShowWorkspaceAwaiting | ShowWorkspaceFail;

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
  /**
   * Column names from the previous call on this session. Reapplied when the
   * caller reuses the table and omits `columns`. A new csv/url/path without
   * `columns` clears it.
   */
  selectedColumns?: readonly string[];
  rememberColumns?: (names: readonly string[] | undefined) => void;
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
    columns: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Step 1. Column names the user asked to chart. Omit to use the whole table. Names only, not cell values.',
    },
    requestedChart: {
      type: 'string',
      description:
        'Step 3. The chart the user asked for: their words, or an id from a previous reply. Omit when they did not name a chart.',
    },
    confirm: {
      type: 'boolean',
      description:
        'Step 5. True only after the user accepts proposedChart. Pass that id as requestedChart. An unfit chart still does not draw.',
    },
  },
} as const;

/**
 * ~2–3 KB. Lists intents, not the 20 engine component ids.
 * The model may send a CSV source; it must not send chart `data[]` rows.
 */
export const SHOW_WORKSPACE_DESCRIPTION = [
  'show_workspace is the only visualization tool. You do not choose a chart. Do not call generate_*.',
  'The server runs these steps in order on every call.',
  '',
  '1. Read the table. Pass one source: csv with the header, url, path, or datasetId.',
  'If the user typed the data in the message, put that table in csv. A chart name is optional.',
  'If they named columns, pass columns as those header names. The chart uses only those columns until a new csv omits them.',
  'url and path are local/dev only. Hosted/production accepts csv or datasetId.',
  'Omit the source to reuse the last table, else the demo CSV. Keep datasetId for the next call.',
  'Never pass data, rows, points, or series. Do not echo table cells after the tool returns.',
  '',
  '2. Classify the columns into a data family before any chart is considered.',
  'intent is required and closed. It is the question, not a chart name.',
  '',
  '3. Compare the chart the user named. Pass it as requestedChart (their words, or an id from a previous reply).',
  'Omit requestedChart when they did not name a chart.',
  '',
  '4. Draw only a chart that fits that family and that this server can draw. It becomes spec.component.',
  'If they named none, decide() chooses from intent.',
  'Output is { spec, summary, datasetId, rowCount, columns }. spec.dataUrl is a signed handle. No row objects.',
  '',
  '5. Otherwise return awaitingUser and do not draw. Show message, then:',
  'proposedChart present — wait. After they accept, call again with requestedChart set to that id, confirm true, and the same datasetId. Named columns stay applied.',
  'proposedChart absent — stop. Do not call again.',
  'confirm true on an unfit chart still does not draw it.',
  '',
  'A refusal is not awaitingUser. Retry a refusal only with a different intent or source.',
  'Do not invent a 7th intent. Follow proposedChart when awaitingUser includes it.',
  'If intent is missing or not in the enum, the tool refuses.',
  'If no catalog component is eligible, the tool refuses with a written reason.',
  '',
  'intent values:',
  'spatial — where, which region, country, city, lat/lng, choropleth. A map needs geo fields and a map token.',
  'comparison — which group is highest or lowest, or how values spread.',
  'summary — a snapshot, total, count, or a few headline numbers.',
  'form — the user must enter or confirm labelled values, not only view a chart.',
  'evidence — claims, sources, entity detail, timelines of supporting facts.',
  'graph — nodes and links, how things connect, not where they sit on a map.',
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
  let tableForChart: Table | undefined;
  if (ingested.ok && !('skip' in ingested)) {
    context.rememberTable?.(ingested.table);
    tableForChart = ingested.table;
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

  const selection = columnSelection(parsed, context);
  if (selection.clear) context.rememberColumns?.(undefined);
  if (selection.names) {
    const source = tableForChart ?? tableFromPayload(runtime.payload);
    if (!source) {
      return fail('invalid_args', 'columns need a table. Pass the message data as csv, or a datasetId.');
    }
    const selected = selectColumns(source, selection.names);
    if (!selected.ok) return selected;
    runtime = contextFromTable(selected.table, runtime);
    context.rememberColumns?.(selected.table.columns.map((column) => column.name));
  }

  const drawingCatalog = catalogWithHostDrawings(runtime.catalog);
  const discussion = parsed.requestedChart
    ? discussChart({
        profile: runtime.profile,
        columns: runtime.classified,
        requestedChart: parsed.requestedChart,
        confirm: parsed.confirm,
        intent: parsed.intent,
        catalogIds: new Set(
          drawingCatalog.map((entry) => entry.id).filter((id): id is string => typeof id === 'string'),
        ),
      })
    : undefined;

  if (discussion?.awaitingUser) {
    const columns = listedColumns(runtime.fields);
    return {
      ok: true,
      awaitingUser: true,
      message: discussion.message,
      dataFamilies: discussion.dataFamilies,
      proposedWhy: discussion.proposedWhy,
      ...(discussion.proposedChart ? { proposedChart: discussion.proposedChart } : {}),
      ...(discussion.requestedChart ? { requestedChart: discussion.requestedChart } : {}),
      ...(datasetId ? { datasetId } : {}),
      ...(typeof runtime.profile.rowCount === 'number' ? { rowCount: runtime.profile.rowCount } : {}),
      ...(columns ? { columns } : {}),
    };
  }

  const decision = decide({
    intent: parsed.intent,
    profile: runtime.profile,
    catalog: runtime.catalog,
  });
  let componentId = discussion?.drawId ?? decision.winner;
  if (
    !discussion?.drawId &&
    componentId === 'kpi-widget' &&
    statusGaugeFits(runtime.payload)
  ) {
    componentId = 'status-gauge-widget';
  }
  if (!componentId) {
    const reason = decision.rejected[0]?.reason ?? decision.trace.tieBreak;
    return fail('no_winner', reason || 'No eligible catalog component for this intent and profile.');
  }

  const winner = drawingCatalog.find((item) => item.id === componentId);
  const allowedActions = discussion?.drawId
    ? (winner?.allowedActions ?? []).filter((action) => SPEC_ACTION_SET.has(action))
    : decision.trace.actions;
  const shaped = shapeSpec(
    {
      component: componentId,
      allowedActions,
    },
    winner,
    runtime.fields,
    runtime.classified,
  );
  if (!shaped.ok) return shaped;

  const fallbackType = chartTypeForComponent(componentId, winner?.chartTypeKeys);
  const payload = workspaceWidgetPayload(
    componentId,
    fallbackType,
    shaped.spec.binds,
    runtime.payload,
  );
  const chartType = chartTypeFromPayload(payload) ?? fallbackType;

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

  const validated = validateSpec(spec, drawingCatalog);
  if (!validated.ok) {
    return fail('invalid_spec', validated.reason);
  }

  const columns = listedColumns(runtime.fields);
  const chartWhy = discussion?.chartWhy || chartWhyFor(componentId) || '';
  const trace = discussion?.drawId
    ? governTrace(
        {
          objective: parsed.intent,
          profile: closedProfile(runtime.profile),
          candidates: [{ id: componentId, score: 1, reasons: [chartWhy] }],
          rejections: decision.trace.rejections.filter((item) => item.id !== componentId),
          actions: allowedActions,
          tieBreak: chartWhy,
        },
        winner?.allowedActions ?? allowedActions,
      )
    : decision.trace;
  assertTraceHasNoRows(trace);
  const proposal = trace.proposal;

  return {
    ok: true,
    spec: validated.spec,
    summary: buildSummary(validated.spec, parsed.intent, componentId, trace.tieBreak),
    ...(chartWhy ? { chartWhy } : {}),
    chartType,
    trace,
    traceId: randomUUID(),
    ...(proposal ? { proposal } : {}),
    ...(datasetId ? { datasetId } : {}),
    ...(typeof runtime.profile.rowCount === 'number' ? { rowCount: runtime.profile.rowCount } : {}),
    ...(columns && columns.length > 0 ? { columns: [...columns] } : {}),
  };
}

/** Engine catalog plus host charts that chart-roles can already name. decide() stays on the engine set. */
function catalogWithHostDrawings(catalog: EngineCatalog): EngineCatalog {
  const ids = new Set(
    catalog.map((entry) => entry.id).filter((id): id is string => typeof id === 'string'),
  );
  const extra: CatalogEntry[] = [];
  for (const meta of collectPortMetadata()) {
    if (!meta.id || ids.has(meta.id) || !(meta.id in CHART_ROLES)) continue;
    if (catalogTierOf(meta) === 'engine') continue;
    extra.push({
      id: meta.id,
      allowedActions: stringList(meta.allowedActions).filter((action) => SPEC_ACTION_SET.has(action)),
      chartTypeKeys: stringList(meta.chartTypeKeys),
    });
  }
  return extra.length === 0 ? catalog : [...catalog, ...extra];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
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

function listedColumns(fields: readonly string[] | undefined): string[] | undefined {
  const columns = fields?.filter((name) => name.trim().length > 0);
  return columns && columns.length > 0 ? [...columns] : undefined;
}

function parseArgs(
  args: unknown,
): { ok: true; intent: Intent; requestedChart?: string; columns?: string[]; confirm: boolean; raw: Record<string, unknown> } | ShowWorkspaceFail {
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
  const allowed = new Set<string>(['intent', 'requestedChart', 'confirm', 'columns', ...INGEST_KEYS]);
  const keys = Object.keys(raw);
  if (keys.some((key) => !allowed.has(key))) {
    return fail(
      'invalid_args',
      'show_workspace accepts intent, optional requestedChart, columns, and confirm, plus csv, url, path, or datasetId.',
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
  if ('requestedChart' in raw && raw.requestedChart !== undefined && typeof raw.requestedChart !== 'string') {
    return fail('invalid_args', 'requestedChart must be a string.');
  }
  if ('confirm' in raw && raw.confirm !== undefined && typeof raw.confirm !== 'boolean') {
    return fail('invalid_args', 'confirm must be a boolean.');
  }
  const requestedChart = typeof raw.requestedChart === 'string' ? raw.requestedChart.trim() : '';
  const columns = parseColumns(raw.columns);
  if (!columns.ok) return columns;
  return {
    ok: true,
    intent: raw.intent,
    confirm: raw.confirm === true,
    ...(requestedChart ? { requestedChart } : {}),
    ...(columns.names ? { columns: columns.names } : {}),
    raw,
  };
}

function parseColumns(value: unknown): { ok: true; names?: string[] } | ShowWorkspaceFail {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return fail('invalid_args', 'columns must be a list of column names, not cell values.');
  }
  const names: string[] = [];
  for (const item of value) {
    const name = item.trim();
    if (!name) return fail('invalid_args', 'columns must be a list of column names, not cell values.');
    if (!names.includes(name)) names.push(name);
  }
  if (names.length === 0) {
    return fail('invalid_args', 'columns must list at least one column name.');
  }
  return { ok: true, names };
}

function columnSelection(
  parsed: { columns?: readonly string[]; raw: Record<string, unknown> },
  context: ShowWorkspaceContext,
): { names?: readonly string[]; clear: boolean } {
  if (parsed.columns) return { names: parsed.columns, clear: false };
  if (freshTableSource(parsed.raw)) return { clear: true };
  if (context.selectedColumns && context.selectedColumns.length > 0) {
    return { names: context.selectedColumns, clear: false };
  }
  return { clear: false };
}

function freshTableSource(raw: Record<string, unknown>): boolean {
  return (['csv', 'url', 'path'] as const).some((key) => {
    const value = raw[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function selectColumns(table: Table, names: readonly string[]): { ok: true; table: Table } | ShowWorkspaceFail {
  const missing: string[] = [];
  const ambiguous: string[] = [];
  const columns: Table['columns'][number][] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const hit = matchColumn(table, name);
    if (hit === 'missing') {
      missing.push(name);
      continue;
    }
    if (hit === 'ambiguous') {
      const headers = table.columns
        .filter((column) => column.name.toLowerCase() === name.toLowerCase())
        .map((column) => column.name);
      ambiguous.push(`${name} (${headers.join(', ')})`);
      continue;
    }
    if (seen.has(hit.name)) continue;
    seen.add(hit.name);
    columns.push(hit);
  }
  if (ambiguous.length > 0) {
    return fail(
      'invalid_args',
      `columns match more than one header: ${ambiguous.join(', ')}. Pass the exact header.`,
    );
  }
  if (missing.length > 0) {
    return fail('invalid_args', `columns not in the table: ${missing.join(', ')}.`);
  }
  return { ok: true, table: { columns } };
}

function matchColumn(table: Table, name: string): Table['columns'][number] | 'missing' | 'ambiguous' {
  const exact = table.columns.find((column) => column.name === name);
  if (exact) return exact;
  const loose = table.columns.filter((column) => column.name.toLowerCase() === name.toLowerCase());
  if (loose.length === 1) return loose[0]!;
  if (loose.length > 1) return 'ambiguous';
  return 'missing';
}

function tableFromPayload(payload: unknown): Table | undefined {
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  const records = payload.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row),
  );
  if (records.length !== payload.length) return undefined;
  return tableFromRecords(records);
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

function chartTypeFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const chartType = (payload as { chartType?: unknown }).chartType;
  return typeof chartType === 'string' && chartType.trim() ? chartType : undefined;
}
