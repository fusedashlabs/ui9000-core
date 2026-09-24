import type { Trace, TraceProposal } from '../trace/trace.js';

/**
 * Frozen `_meta` keys for the chart App.
 * chart-app reads this contract. It does not invent keys.
 *
 * `_meta.trace` is the decision record.
 * `_meta.proposal` is optional and present only when an action is held.
 * `ui.resourceUri` stays `ui://ui9000/chart`.
 */
export const META_RESOURCE_URI = 'ui://ui9000/chart';

export const FROZEN_META_KEYS = ['_meta.trace', '_meta.proposal', 'ui.resourceUri'] as const;

const ROW_KEYS = new Set(['rows', 'data']);

export type WorkspaceMetaInput = {
  resourceUri: string;
  csp: unknown;
  chartType: string;
  dataUrl: string;
  chartId: string;
  trace?: Trace;
  proposal?: TraceProposal;
};

/** The object chart-app is allowed to read. Resource URI is not renamed. */
export function workspaceMeta(input: WorkspaceMetaInput): Record<string, unknown> {
  return {
    ui: {
      resourceUri: input.resourceUri,
      visibility: ['model', 'app'],
      csp: input.csp,
    },
    'ui/resourceUri': input.resourceUri,
    chartType: input.chartType,
    dataUrl: input.dataUrl,
    chartId: input.chartId,
    ...(input.trace ? { trace: input.trace } : {}),
    ...(input.proposal ? { proposal: input.proposal } : {}),
  };
}

const DECISION_KEYS = new Set(['trace', 'proposal', 'proposals']);

/**
 * Drops dataset `rows` everywhere.
 * Drops a `data` array only inside a decision record (`trace`, `proposal`, `proposals`).
 * A `data` array on the tool result itself is left alone.
 */
export function omitRowArrays<T>(value: T, insideDecision = false): T {
  if (Array.isArray(value)) {
    return value.map((item) => omitRowArrays(item, insideDecision)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(child) && key === 'rows') continue;
    if (Array.isArray(child) && key === 'data' && insideDecision) continue;
    const childInside = insideDecision || DECISION_KEYS.has(key);
    next[key] = omitRowArrays(child, childInside);
  }
  return next as T;
}
export function containsRowArrays(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRowArrays);
  if (!value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (ROW_KEYS.has(key) && Array.isArray(child)) return true;
    if (containsRowArrays(child)) return true;
  }
  return false;
}
