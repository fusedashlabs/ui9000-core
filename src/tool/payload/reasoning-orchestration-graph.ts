/**
 * Reasoning orchestration object for `<ui9000-reasoning-orchestration-graph>` (AM-1).
 *
 * Rows are reasoning steps: one per step with the step it came from (or one
 * per link, `source,target`, whose other columns describe the target), a
 * stage or a depth, and the active path, either as a flag on the steps that
 * are on it or as the id of one of the paths a path column names. Optional
 * columns add the model, the state, a score, a label, step entropy and stage
 * metrics such as accuracy or compute.
 *
 * The reading is reasoning structure, so the rows fit only with a stage or a
 * depth on almost every step and an active path of two steps or more. A
 * free-form adjacency list has neither and stays network-graph.
 */

import {
  ACTIVE_KEYS,
  ACTIVE_PATH_KEYS,
  DEPTH_KEYS,
  EDGE_PAIRS,
  ENTROPY_KEYS,
  LABEL_KEYS,
  MODEL_KEYS,
  normalizeKey,
  PARENT_KEYS,
  PATH_KEYS,
  SCORE_KEYS,
  STAGE_KEYS,
  STAGE_METRIC_KEYS,
  STATE_KEYS,
  STEP_KEYS,
  TITLE_KEYS,
} from '../../profiler/orchestration-columns.js';

/** Fewer steps than this is a list, not a process to inspect. */
const MIN_STEPS = 4;
/** Share of rows that must carry a stage or a depth. */
const PLACED_COVERAGE = 0.8;
/** Candidate paths beyond this are left as plain links. */
const MAX_PATHS = 12;
/** Distinct models beyond this are not models but labels. */
const MAX_MODELS = 8;

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'x', 'active', 'selected', 'chosen', 'best', 'on']);

type Columns = {
  mode: 'steps' | 'edges';
  step: string;
  parent: string;
  stage?: string;
  depth?: string;
  model?: string;
  state?: string;
  score?: string;
  path?: string;
  active?: string;
  activePath?: string;
  label?: string;
  entropy?: string;
  title?: string;
  metrics: string[];
};

type Step = {
  id: string;
  label?: string;
  stage?: string;
  depth?: number;
  model?: string;
  state?: string;
  score?: number;
  parent?: string;
};

type Orchestration = {
  title?: string;
  models: { id: string; name: string }[];
  stages: { id: string; label: string; metrics?: Record<string, number> }[];
  nodes: Step[];
  links: { source: string; target: string }[];
  paths: { id: string; label: string; nodes: string[] }[];
  activePath: string | string[];
  entropy?: { series: { label: string; values: number[] }[] };
};

export function reasoningOrchestrationPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const read = readOrchestration(rows);
  if (!read) return null;
  const out: Record<string, unknown> = { chartType: 'reasoningOrchestrationGraph' };
  if (read.title) out.title = read.title;
  if (read.models.length) out.models = read.models;
  if (read.stages.length) out.stages = read.stages;
  out.nodes = read.nodes;
  out.links = read.links;
  if (read.paths.length) out.paths = read.paths;
  out.activePath = read.activePath;
  if (read.entropy) out.entropy = read.entropy;
  return out;
}

/**
 * True when the payload is a reasoning orchestration: rows of linked steps
 * with a stage or a depth and an active path, or an object that already
 * carries nodes or links, stages or depths, and an active path.
 */
export function reasoningOrchestrationFits(payload: unknown): boolean {
  if (Array.isArray(payload)) return readOrchestration(payload.filter(isRecord)) !== null;
  if (!isRecord(payload)) return false;
  const nodes = Array.isArray(payload.nodes) ? payload.nodes.filter(isRecord) : [];
  const links = Array.isArray(payload.links) ? payload.links : [];
  const active = payload.activePath ?? payload.activePathId;
  const placed =
    (Array.isArray(payload.stages) && payload.stages.length > 0) ||
    nodes.some((node) => node.depth !== undefined || node.stage !== undefined);
  const hasActive = Array.isArray(active) ? active.length >= 2 : text(active) !== '';
  return (nodes.length > 0 || links.length > 0) && placed && hasActive;
}

function readOrchestration(rows: Record<string, unknown>[]): Orchestration | null {
  if (rows.length < MIN_STEPS - 1) return null;
  const columns = readColumns(rows);
  if (!columns) return null;

  const steps = new Map<string, Step>();
  const links = new Map<string, { source: string; target: string }>();
  const pathOf = new Map<string, string>();
  const marked = new Set<string>();
  const markedPaths = new Set<string>();
  let placed = 0;

  const ensure = (id: string) => {
    if (!steps.has(id)) steps.set(id, { id });
    return steps.get(id)!;
  };

  for (const row of rows) {
    const id = text(row[columns.step]);
    const parent = text(row[columns.parent]);
    if (!id) return null;
    if (columns.mode === 'edges' && !parent) return null;
    const step = ensure(id);
    if (parent && parent !== id) {
      ensure(parent);
      if (!links.has(`${parent}->${id}`)) links.set(`${parent}->${id}`, { source: parent, target: id });
      step.parent ??= parent;
    }

    const stage = columns.stage ? text(row[columns.stage]) : '';
    const depth = columns.depth ? num(row[columns.depth]) : undefined;
    if (stage || depth !== undefined) placed += 1;
    if (stage && step.stage === undefined) step.stage = stage;
    if (depth !== undefined && step.depth === undefined) step.depth = Math.max(0, depth);
    assign(step, 'label', columns.label ? text(row[columns.label]) : '');
    assign(step, 'model', columns.model ? text(row[columns.model]) : '');
    assign(step, 'state', columns.state ? text(row[columns.state]) : '');
    const score = columns.score ? num(row[columns.score]) : undefined;
    if (score !== undefined && step.score === undefined) step.score = score;

    const path = columns.path ? text(row[columns.path]) : '';
    if (path && !pathOf.has(id)) pathOf.set(id, path);
    if (columns.active && TRUTHY.has(text(row[columns.active]).toLowerCase())) {
      marked.add(id);
      if (columns.mode === 'edges') marked.add(parent);
      if (path) markedPaths.add(path);
    }
  }

  if (steps.size < MIN_STEPS) return null;
  if (placed / rows.length < PLACED_COVERAGE) return null;

  // Paths: the chain from the root to the deepest step a path value names.
  const depthOf = depths(steps);
  const chainTo = (id: string) => {
    const chain: string[] = [];
    let cursor: string | undefined = id;
    for (let guard = 0; cursor && guard <= steps.size; guard += 1) {
      if (chain.includes(cursor)) break;
      chain.push(cursor);
      cursor = steps.get(cursor)?.parent;
    }
    return chain.reverse();
  };
  const deepest = (ids: string[]) =>
    ids.reduce((best, id) => (depthOf.get(id)! > depthOf.get(best)! ? id : best), ids[0]!);
  const pathIds = [...new Set(pathOf.values())];
  const paths = pathIds
    .map((pathId) => {
      const members = [...pathOf.entries()].filter(([, value]) => value === pathId).map(([id]) => id);
      return { id: pathId, label: pathId, nodes: chainTo(deepest(members)) };
    })
    .filter((path) => path.nodes.length >= 2);

  // Active path: a named path id, then the one path the flagged steps share, then the flagged chain.
  let activePath: string | string[] | null = null;
  const named = columns.activePath ? sameText(rows, columns.activePath) : undefined;
  if (named && paths.some((path) => path.id === named)) activePath = named;
  else if (markedPaths.size === 1 && paths.some((path) => markedPaths.has(path.id))) activePath = [...markedPaths][0]!;
  else if (marked.size) {
    const chain = chainTo(deepest([...marked]));
    if (chain.length >= 2) activePath = chain;
  }
  if (activePath === null) return null;

  // Keep the active path among the paths sent, then the rest up to the cap.
  const keptPaths = [
    ...paths.filter((path) => path.id === activePath),
    ...paths.filter((path) => path.id !== activePath),
  ].slice(0, MAX_PATHS);

  const nodes = [...steps.values()];
  const modelNames = [...new Set(nodes.map((node) => node.model).filter((m): m is string => !!m))];
  const models = modelNames.length <= MAX_MODELS ? modelNames.map((name) => ({ id: name, name })) : [];
  if (!models.length) for (const node of nodes) delete node.model;

  return {
    ...(columns.title && sameText(rows, columns.title) ? { title: sameText(rows, columns.title)! } : {}),
    models,
    stages: stagesOf(rows, columns, nodes, depthOf),
    nodes,
    links: [...links.values()],
    paths: keptPaths,
    activePath,
    ...entropyOf(rows, columns),
  };
}

/** Stages in depth order, each with the mean of every stage metric column over its rows. */
function stagesOf(
  rows: Record<string, unknown>[],
  columns: Columns,
  nodes: Step[],
  depthOf: Map<string, number>,
): Orchestration['stages'] {
  if (!columns.stage) return [];
  const order = new Map<string, { first: number; minDepth: number }>();
  nodes.forEach((node, index) => {
    if (!node.stage) return;
    const known = order.get(node.stage);
    const d = depthOf.get(node.id) ?? 0;
    if (!known) order.set(node.stage, { first: index, minDepth: d });
    else known.minDepth = Math.min(known.minDepth, d);
  });
  const names = [...order.entries()]
    .sort((a, b) => a[1].minDepth - b[1].minDepth || a[1].first - b[1].first)
    .map(([name]) => name);
  return names.map((name) => {
    const metrics: Record<string, number> = {};
    for (const column of columns.metrics) {
      const values = rows
        .filter((row) => text(row[columns.stage!]) === name)
        .map((row) => num(row[column]))
        .filter((v): v is number => v !== undefined);
      if (values.length) metrics[column] = values.reduce((a, b) => a + b, 0) / values.length;
    }
    return { id: name, label: name, ...(Object.keys(metrics).length ? { metrics } : {}) };
  });
}

function entropyOf(rows: Record<string, unknown>[], columns: Columns): Pick<Orchestration, 'entropy'> {
  if (!columns.entropy) return {};
  const values = rows.map((row) => num(row[columns.entropy!])).filter((v): v is number => v !== undefined);
  return values.length >= 2 ? { entropy: { series: [{ label: columns.entropy, values }] } } : {};
}

/** Explicit depths where given, else links from a root. */
function depths(steps: Map<string, Step>): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (id: string, guard: number): number => {
    if (out.has(id)) return out.get(id)!;
    const step = steps.get(id)!;
    const parent = step.parent && steps.has(step.parent) && guard < steps.size ? step.parent : undefined;
    const d = step.depth ?? (parent ? visit(parent, guard + 1) + 1 : 0);
    out.set(id, d);
    return d;
  };
  for (const id of steps.keys()) visit(id, 0);
  return out;
}

/** The step and parent columns (or a link pair), plus the optional ones. */
function readColumns(rows: Record<string, unknown>[]): Columns | null {
  // Every row's keys: an optional column may be absent from the first rows of a JSON payload.
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const taken: string[] = [];
  const find = (set: ReadonlySet<string>) => {
    const key = keys.find((name) => set.has(normalizeKey(name)) && !taken.includes(name));
    if (key) taken.push(key);
    return key;
  };
  const byName = (name: string) => keys.find((key) => normalizeKey(key) === name);

  let mode: Columns['mode'] = 'steps';
  let step: string | undefined;
  let parent: string | undefined;
  for (const [from, to] of EDGE_PAIRS) {
    const source = byName(from);
    const target = byName(to);
    if (source && target) {
      mode = 'edges';
      step = target;
      parent = source;
      taken.push(source, target);
      break;
    }
  }
  if (!step) {
    parent = find(PARENT_KEYS);
    step = find(STEP_KEYS);
  }
  if (!step || !parent) return null;

  const stage = find(STAGE_KEYS);
  const depth = find(DEPTH_KEYS);
  if (!stage && !depth) return null;
  const activePath = find(ACTIVE_PATH_KEYS);
  const active = find(ACTIVE_KEYS);
  if (!active && !activePath) return null;

  const columns: Columns = {
    mode,
    step,
    parent,
    metrics: [],
    ...optional('stage', stage),
    ...optional('depth', depth),
    ...optional('active', active),
    ...optional('activePath', activePath),
    ...optional('path', find(PATH_KEYS)),
    ...optional('model', find(MODEL_KEYS)),
    ...optional('state', find(STATE_KEYS)),
    ...optional('score', find(SCORE_KEYS)),
    ...optional('entropy', find(ENTROPY_KEYS)),
    ...optional('title', find(TITLE_KEYS)),
    ...optional('label', find(LABEL_KEYS)),
  };
  columns.metrics = keys.filter((key) => STAGE_METRIC_KEYS.has(normalizeKey(key)) && !taken.includes(key));
  return columns;
}

function assign(step: Step, field: 'label' | 'model' | 'state', value: string): void {
  if (value && step[field] === undefined) step[field] = value;
}

function optional<K extends string>(name: K, key: string | undefined): Partial<Record<K, string>> {
  return key ? ({ [name]: key } as Record<K, string>) : {};
}

function sameText(rows: Record<string, unknown>[], key: string): string | undefined {
  const first = text(rows[0]![key]);
  if (!first) return undefined;
  return rows.every((row) => text(row[key]) === first) ? first : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).trim()
    : '';
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const n = Number(value.trim().replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(n) ? n : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
