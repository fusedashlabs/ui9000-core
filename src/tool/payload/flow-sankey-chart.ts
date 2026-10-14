/**
 * Multi-stage flow for `flow-sankey-chart`: stages, nodes, and severity links.
 *
 * Two table shapes become one graph:
 * - a link table (`source`, `target`, value): a node's stage is its longest
 *   path from a root, the column the widget draws it in;
 * - a hierarchy table: one category column per stage, left to right
 *   (category → subcategory → cause → outcome), and a value per row.
 *
 * Fewer than three stages is a two-column Sankey, so this returns null and
 * `sankey-chart` draws it. A cycle has no stages and is refused.
 */

import { normalizeName } from '../../profiler/table.js';

export const MIN_FLOW_STAGES = 3;

const SEVERITIES = ['high', 'medium', 'low', 'info'] as const;
type Severity = (typeof SEVERITIES)[number];

type Hint = { name: string; role: string };

type FlowNode = { id: string; label: string; stage: number; value: number; share: number };
type FlowLink = { source: string; target: string; value: number; severity?: Severity };

export type FlowGraph = {
  stages: string[];
  nodes: FlowNode[];
  links: FlowLink[];
  valueField: string;
};

export function flowSankeyChartPayload(
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
  columns?: readonly Hint[],
): unknown | null {
  const graph = flowGraph(fields, rows, columns);
  if (!graph) return null;
  const valueLabel = words(graph.valueField);
  const total = flowTotal(graph.nodes);
  const range = dateRange(rows, columns);
  return {
    chartType: chartType || 'flowSankeyChart',
    name: 'flow-sankey-chart',
    stages: graph.stages,
    nodes: graph.nodes,
    links: graph.links,
    valueLabel,
    summary: [
      {
        label: `Total ${valueLabel}`,
        value: formatCount(total),
        caption: range ? `For ${range.days} ${range.days === 1 ? 'day' : 'days'}` : '',
        icon: 'list',
      },
      ...(range ? [{ label: 'Time range', value: '', caption: range.text, icon: 'calendar' }] : []),
    ],
  };
}

/** Three or more stages. Lets the engine draw the flow as `flow-sankey-chart`. */
export function flowSankeyFits(payload: unknown, columns?: readonly Hint[]): boolean {
  if (!Array.isArray(payload) || payload.length === 0) return false;
  const rows = payload.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row),
  );
  if (rows.length !== payload.length) return false;
  return flowGraph({}, rows, columns) !== null;
}

/** The staged graph, or null below three stages, on a cycle, or with no positive value. */
export function flowGraph(
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
  columns?: readonly Hint[],
): FlowGraph | null {
  if (rows.length === 0) return null;
  const keys = Object.keys(rows[0]!);
  // Without the profiler's roles, a numeric column is a value and any other is a stage.
  const role = columns
    ? (name: string) => columns.find((column) => column.name === name)?.role
    : (name: string) => (numericKey(rows, [name]) ? 'metric' : 'category');
  const value = pick(keys, fields.y) ?? keys.find((key) => role(key) === 'metric') ?? numericKey(rows);
  if (!value) return null;

  const links = keys.filter((key) => role(key) === 'link');
  const source = pick(keys, fields.source) ?? links[0];
  const target = pick(keys, fields.target) ?? links[1];
  const linkTable = columns ? role(source ?? '') === 'link' && role(target ?? '') === 'link' : !!source && !!target;
  const used = [value, ...(linkTable ? [source!, target!] : [])];
  const severity = severityKey(rows, keys.filter((key) => !used.includes(key)), role);

  const graph = linkTable
    ? fromLinks(rows, source!, target!, value, severity)
    : fromStages(rows, stageKeys(keys, value, severity, role), value, severity);
  if (!graph || graph.stages.length < MIN_FLOW_STAGES) return null;
  return graph;
}

function fromLinks(
  rows: Record<string, unknown>[],
  source: string,
  target: string,
  value: string,
  severity: string | undefined,
): FlowGraph | null {
  const links = new Map<string, FlowLink>();
  for (const row of rows) {
    const from = cell(row, source);
    const to = cell(row, target);
    const amount = Number(row[value]);
    if (!from || !to || from === to || !Number.isFinite(amount) || amount <= 0) continue;
    addLink(links, from, to, amount, severityOf(row, severity));
  }
  if (links.size === 0) return null;
  const list = [...links.values()];
  const stageOf = longestPath(list);
  if (!stageOf) return null;
  const depth = Math.max(...stageOf.values()) + 1;
  return {
    stages: Array.from({ length: depth }, () => ''),
    nodes: sizedNodes(list, stageOf, (id) => id),
    links: list,
    valueField: value,
  };
}

function fromStages(
  rows: Record<string, unknown>[],
  stages: string[],
  value: string,
  severity: string | undefined,
): FlowGraph | null {
  if (stages.length < MIN_FLOW_STAGES) return null;
  const links = new Map<string, FlowLink>();
  const stageOf = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const row of rows) {
    const amount = Number(row[value]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const level = severityOf(row, severity);
    // A label can sit in two stages ("Filter Loss"), so the id carries the stage.
    const ids = stages.map((key, stage) => {
      const label = cell(row, key);
      if (!label) return undefined;
      const id = `${stage}:${label}`;
      stageOf.set(id, stage);
      labels.set(id, label);
      return id;
    });
    for (let index = 0; index < ids.length - 1; index += 1) {
      const from = ids[index];
      const to = ids[index + 1];
      if (from && to) addLink(links, from, to, amount, level);
    }
  }
  if (links.size === 0) return null;
  const list = [...links.values()];
  return {
    stages: stages.map(words),
    nodes: sizedNodes(list, stageOf, (id) => labels.get(id) ?? id),
    links: list,
    valueField: value,
  };
}

function addLink(
  links: Map<string, FlowLink>,
  source: string,
  target: string,
  value: number,
  severity: Severity | undefined,
): void {
  // One ribbon per pair and severity. A pair that splits by severity keeps both colours.
  const key = `${source}\0${target}\0${severity ?? ''}`;
  const existing = links.get(key);
  if (existing) existing.value += value;
  else links.set(key, { source, target, value, ...(severity ? { severity } : {}) });
}

/** Stage per node: its longest path from a root. Null when the links form a cycle. */
function longestPath(links: readonly FlowLink[]): Map<string, number> | null {
  const parents = new Map<string, string[]>();
  const ids = new Set<string>();
  for (const link of links) {
    ids.add(link.source);
    ids.add(link.target);
    const list = parents.get(link.target) ?? [];
    list.push(link.source);
    parents.set(link.target, list);
  }
  const stage = new Map<string, number>();
  const open = new Set<string>();
  let cyclic = false;
  const walk = (id: string): number => {
    const known = stage.get(id);
    if (known !== undefined) return known;
    if (open.has(id)) {
      cyclic = true;
      return 0;
    }
    open.add(id);
    let best = 0;
    for (const parent of parents.get(id) ?? []) best = Math.max(best, walk(parent) + 1);
    open.delete(id);
    stage.set(id, best);
    return best;
  };
  for (const id of ids) walk(id);
  return cyclic ? null : stage;
}

/**
 * Value is the larger side of a node, so a pass-through is not counted twice.
 * Share follows the widget's badge: of the sole parent, else of the flow total.
 */
function sizedNodes(
  links: readonly FlowLink[],
  stageOf: ReadonlyMap<string, number>,
  labelOf: (id: string) => string,
): FlowNode[] {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  const parents = new Map<string, Set<string>>();
  const order: string[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    outflow.set(link.source, (outflow.get(link.source) ?? 0) + link.value);
    inflow.set(link.target, (inflow.get(link.target) ?? 0) + link.value);
    const from = parents.get(link.target) ?? new Set<string>();
    from.add(link.source);
    parents.set(link.target, from);
    for (const id of [link.source, link.target]) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
  }
  const valueOf = (id: string) => Math.max(inflow.get(id) ?? 0, outflow.get(id) ?? 0);
  const stageTotals = new Map<number, number>();
  for (const id of order) {
    const stage = stageOf.get(id) ?? 0;
    stageTotals.set(stage, (stageTotals.get(stage) ?? 0) + valueOf(id));
  }
  const total = Math.max(0, ...stageTotals.values());
  const nodes = order.map((id) => {
    const value = valueOf(id);
    const from = parents.get(id);
    const parent = from && from.size === 1 ? valueOf([...from][0]!) : 0;
    const base = parent > 0 ? parent : total;
    return {
      id,
      label: labelOf(id),
      stage: stageOf.get(id) ?? 0,
      value,
      share: base > 0 ? round(value / base) : 0,
    };
  });
  return nodes.sort((a, b) => a.stage - b.stage);
}

/** Category columns in table order, minus the value and the severity. */
function stageKeys(
  keys: readonly string[],
  value: string,
  severity: string | undefined,
  role: (name: string) => string | undefined,
): string[] {
  return keys.filter((key) => key !== value && key !== severity && role(key) === 'category');
}

/** A `severity` column, or a category whose every value is high, medium, low, or info. */
function severityKey(
  rows: Record<string, unknown>[],
  keys: readonly string[],
  role: (name: string) => string | undefined,
): string | undefined {
  const named = keys.find((key) => normalizeName(key) === 'severity');
  if (named) return named;
  return keys.find((key) => {
    if (role(key) && role(key) !== 'category') return false;
    const values = rows.map((row) => cell(row, key)).filter(Boolean);
    return values.length > 0 && values.every((text) => asSeverity(text) !== undefined);
  });
}

function severityOf(row: Record<string, unknown>, key: string | undefined): Severity | undefined {
  return key ? asSeverity(cell(row, key)) : undefined;
}

function asSeverity(text: string): Severity | undefined {
  const key = text.trim().toLowerCase();
  return (SEVERITIES as readonly string[]).includes(key) ? (key as Severity) : undefined;
}

/** The busiest stage carries the whole flow. */
function flowTotal(nodes: readonly FlowNode[]): number {
  const totals = new Map<number, number>();
  for (const node of nodes) totals.set(node.stage, (totals.get(node.stage) ?? 0) + node.value);
  return Math.max(0, ...totals.values());
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const DAY_MS = 86_400_000;

/** First and last day of the temporal column, when every value is an ISO date. */
function dateRange(
  rows: Record<string, unknown>[],
  columns?: readonly Hint[],
): { days: number; text: string } | undefined {
  const field = columns?.find((column) => column.role === 'temporal')?.name;
  if (!field) return undefined;
  const days: number[] = [];
  for (const row of rows) {
    const text = cell(row, field);
    if (!text) continue;
    if (!ISO_DAY.test(text)) return undefined;
    const time = Date.parse(`${text.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(time)) return undefined;
    days.push(time);
  }
  if (days.length === 0) return undefined;
  const first = new Date(Math.min(...days));
  const last = new Date(Math.max(...days));
  const count = Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1;
  const day = (date: Date, year: boolean) =>
    date.toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'long',
      day: 'numeric',
      ...(year ? { year: 'numeric' } : {}),
    });
  const sameYear = first.getUTCFullYear() === last.getUTCFullYear();
  const text =
    count === 1 ? day(first, true) : `${day(first, !sameYear)} – ${day(last, true)}`;
  return { days: count, text };
}

function pick(keys: readonly string[], field: string | undefined): string | undefined {
  return field && keys.includes(field) ? field : undefined;
}

function numericKey(
  rows: Record<string, unknown>[],
  keys: readonly string[] = Object.keys(rows[0]!),
): string | undefined {
  return keys.find((key) =>
    rows.some((row) => String(row[key] ?? '').trim() !== '' && Number.isFinite(Number(row[key]))),
  );
}

function cell(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? '').trim();
}

/** `event_count` → `Event Count`, for stage headers, the header card, and the tooltip. */
function words(field: string): string {
  return field
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatCount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round(value));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
