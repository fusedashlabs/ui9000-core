import { decide } from '../engine/decide.js';
import type { CatalogEntry, EngineCatalog } from '../spec/engine-catalog.js';
import type { DataProfile } from '../spec/data-profile.js';
import { INTENTS, type Intent } from '../spec/intent.js';
import type { WorkspaceSpec } from '../spec/workspace-spec.js';
import { validateSpec } from '../validate/validate-spec.js';
import type { ClassifiedColumn } from '../profiler/roles.js';
import { attachDataHandle, type SignDataLink } from './data-channel.js';
import { chartTypeForComponent, workspaceWidgetPayload } from './widget-payload.js';

export const SHOW_WORKSPACE_NAME = 'show_workspace';

const ARG_ROW_KEYS = ['data', 'points', 'series', 'rows'] as const;

export const SHOW_WORKSPACE_CODES = [
  'invalid_args',
  'rows_in_args',
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
        'Closed objective. One of spatial, comparison, summary, form, evidence, graph. Do not invent values. Do not pass data rows.',
    },
  },
} as const;

/**
 * ~2–3 KB. Lists intents, not the 20 engine component ids.
 * The model must not send dataset rows; the engine picks the component.
 */
export const SHOW_WORKSPACE_DESCRIPTION = [
  'show_workspace renders one workspace for the current dataset.',
  'Call this tool once per user question. It is the only visualization tool.',
  'Pass a single field: intent. Never pass data, rows, points, series, records, or CSV.',
  'Never paste table cells, GeoJSON features, KPI values, or form answers into arguments.',
  'Rows never belong in this tool. The server already holds the dataset.',
  'A signed data handle is attached to the spec. The widget fetches rows itself.',
  'You do not choose a chart type, widget id, or catalog component.',
  'Do not name a visualization as a tool argument. Do not call generate_* tools.',
  '',
  'intent is a closed enum. Use exactly one of the following values.',
  '',
  'spatial — geography: points, regions, choropleth, tokens, lat/lng, country, state, city.',
  'Use spatial when the question is where, which region, which country, or a map join.',
  'The engine may pick a map only when the profile has geo fields and a map token.',
  '',
  'comparison — groups versus a metric: category cardinality, rankings, distributions.',
  'Use comparison when the question is which group is highest, lowest, or how values spread.',
  'The engine may pick a bar for a handful of categories, or a histogram for a numeric shape.',
  '',
  'summary — headlines and KPIs for a small set of numeric facts.',
  'Use summary when the user wants a snapshot, total, count, or a few headline numbers.',
  '',
  'form — labelled controls the user should fill in: text, number, select, dates, submit.',
  'Use form when the user must enter or confirm values, not when they only want a chart.',
  'Every control must already be labelled in the profile (allControlsLabelled).',
  '',
  'evidence — claims, sources, entity detail, timelines of supporting facts.',
  'Use evidence when the question is what supports this claim or who this entity is.',
  '',
  'graph — nodes and links, networks, relationships between entities.',
  'Use graph when the question is how things connect, not where they sit on a map.',
  'Network chat may still call this tool; it is visualization, not a mutate.',
  '',
  'Output is always { spec, summary }. spec.component is chosen by decide() on the server.',
  'summary is short labels: component id, intent, and a reason sentence. No row objects.',
  'spec.dataUrl is a signed link. spec.callServerTool is how the widget reads rows.',
  'If you include data: [{...}] the tool refuses. Empty data arrays are also refused.',
  'If intent is missing or not in the enum, the tool refuses.',
  'If no catalog component is eligible, the tool refuses with a written reason.',
  'Do not retry with rows. Retry only with a different intent from the closed list.',
  'Do not invent a 7th intent. Keep the call small: {"intent":"comparison"} is complete.',
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

  const decision = decide({
    intent: parsed.intent,
    profile: context.profile,
    catalog: context.catalog,
  });
  if (!decision.winner) {
    const reason = decision.rejected[0]?.reason ?? decision.trace.tieBreak;
    return fail('no_winner', reason || 'No eligible catalog component for this intent and profile.');
  }

  const winner = context.catalog.find((item) => item.id === decision.winner);
  const shaped = shapeSpec(
    {
      component: decision.winner,
      allowedActions: decision.trace.actions,
    },
    winner,
    context.fields,
    context.classified,
  );
  if (!shaped.ok) return shaped;

  const chartType = chartTypeForComponent(decision.winner, winner?.chartTypeKeys);
  const payload = workspaceWidgetPayload(
    decision.winner,
    chartType,
    shaped.spec.binds,
    context.payload,
  );

  let spec: WorkspaceSpec;
  try {
    const attached = await attachDataHandle(
      shaped.spec,
      payload,
      context.signDataLink,
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

  const validated = validateSpec(spec, context.catalog);
  if (!validated.ok) {
    return fail('invalid_spec', validated.reason);
  }

  return {
    ok: true,
    spec: validated.spec,
    summary: buildSummary(validated.spec, parsed.intent, decision.winner, decision.trace.tieBreak),
    ...(chartType ? { chartType } : {}),
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
): { ok: true; intent: Intent } | ShowWorkspaceFail {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return fail('invalid_args', 'show_workspace arguments must be an object.');
  }
  const raw = args as Record<string, unknown>;
  if (ARG_ROW_KEYS.some((key) => key in raw)) {
    return fail(
      'rows_in_args',
      'show_workspace refuses dataset rows in arguments. Pass intent only; rows travel through the data handle.',
    );
  }
  const keys = Object.keys(raw);
  if (keys.some((key) => key !== 'intent')) {
    return fail('invalid_args', 'show_workspace accepts only intent.');
  }
  if (typeof raw.intent !== 'string' || !isIntent(raw.intent)) {
    return fail(
      'unknown_intent',
      `intent must be one of ${INTENTS.join(', ')}.`,
    );
  }
  return { ok: true, intent: raw.intent };
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
