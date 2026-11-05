/**
 * Goals and insights object for `<ui9000-goals-insights>`.
 *
 * The evidence behind one goal: one row per claim its agents filed, with the
 * goal it was filed under and its age in hours. Optional claim columns add
 * its stance, state, type, subject, sources, records, weight, the agent that
 * filed it, the asset kind it is about, and the other goals it bears on.
 * Goal columns (name, status, confidence, priority, agents) repeat on each
 * of the goal's claims; the first value sent wins.
 *
 * The goal with the most claims is the one the column is drawn for; the
 * others are the goals it shares evidence with. The rows fit only when every
 * claim has its text, its goal and its age, and the goals are few. A
 * free-form adjacency list stays network-graph.
 */

import {
  AGE_KEYS,
  AGENT_TOTAL_KEYS,
  ALSO_KEYS,
  ASSET_KEYS,
  CLAIM_ID_KEYS,
  CLAIM_KEYS,
  CLAIM_STATE_KEYS,
  CLAIM_TYPE_KEYS,
  CONFIDENCE_KEYS,
  FILED_BY_KEYS,
  GOAL_ID_KEYS,
  GOAL_KEYS,
  GOAL_NAME_KEYS,
  GOAL_STATUS_KEYS,
  POLARITY_KEYS,
  PRIORITY_KEYS,
  RECORDS_KEYS,
  SOURCES_KEYS,
  THEME_KEYS,
  TITLE_KEYS,
  WEIGHT_KEYS,
} from '../../profiler/insight-columns.js';
import { normalizeName } from '../../profiler/table.js';

/** Fewer claims than this is a list, not a column of evidence. */
const MIN_CLAIMS = 5;
/** More goals than this is a comparison of goals, not the evidence behind one. */
const MAX_GOALS = 8;
const CLAIM_TYPES = new Set(['gap', 'observation', 'correlation', 'anomaly', 'recommendation']);

type Goal = {
  id: string;
  name: string;
  status?: string;
  confidence?: number | string;
  priority?: string;
  total?: number;
};

type Claim = {
  id?: string;
  goal: string;
  claim: string;
  age: number;
  also?: string;
  theme?: string;
  polarity?: string;
  state?: string;
  type?: string;
  sources?: number;
  records?: number;
  weight?: number | string;
  agent?: string;
  asset?: string;
};

type Insights = {
  title?: string;
  goal: Goal;
  connected: Goal[];
  claims: Claim[];
};

type Columns = {
  goal: string;
  claim: string;
  age: string;
  goalName?: string;
  status?: string;
  confidence?: string;
  priority?: string;
  agents?: string;
  id?: string;
  also?: string;
  theme?: string;
  polarity?: string;
  state?: string;
  type?: string;
  sources?: string;
  records?: string;
  weight?: string;
  agent?: string;
  asset?: string;
  title?: string;
};

export function goalsInsightsPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const insights = readInsights(rows);
  if (!insights) return null;
  return {
    chartType: 'goalsInsights',
    ...(insights.title ? { title: insights.title } : {}),
    goal: insights.goal,
    ...(insights.connected.length > 0 ? { connected: insights.connected } : {}),
    claims: insights.claims,
  };
}

/**
 * True when the rows are claims filed under a few goals, each with its text,
 * its goal and its age in hours.
 */
export function goalsInsightsFits(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false;
  return readInsights(payload.filter(isRecord)) !== null;
}

function readInsights(rows: Record<string, unknown>[]): Insights | null {
  if (rows.length < MIN_CLAIMS) return null;
  const columns = readColumns(rows);
  if (!columns) return null;

  const goals = new Map<string, Goal & { claims: number }>();
  const claims: Claim[] = [];
  for (const row of rows) {
    const goalId = text(row[columns.goal]);
    const said = text(row[columns.claim]);
    const age = num(text(row[columns.age]).replace(/\s*h(ours?)?$/i, ''));
    if (!goalId || !said || age === undefined || age < 0) return null;

    let goal = goals.get(goalId);
    if (!goal) {
      goal = { id: goalId, name: goalId, claims: 0 };
      goals.set(goalId, goal);
    }
    goal.claims += 1;
    readGoalColumns(goal, row, columns);
    claims.push(readClaim(goalId, said, age, row, columns));
  }

  if (goals.size > MAX_GOALS) return null;
  const ranked = [...goals.values()].sort((a, b) => b.claims - a.claims);
  const [main, ...connected] = ranked.map(({ claims: count, ...goal }) => {
    void count;
    return goal;
  });
  const title = columns.title ? sameText(rows, columns.title) : undefined;
  return { ...(title ? { title } : {}), goal: main!, connected, claims };
}

function readGoalColumns(goal: Goal, row: Record<string, unknown>, columns: Columns): void {
  if (columns.goalName && goal.name === goal.id) {
    const name = text(row[columns.goalName]);
    if (name) goal.name = name;
  }
  if (columns.status && goal.status === undefined) {
    const status = text(row[columns.status]).toLowerCase().replace(/[_-]+/g, ' ');
    if (status) goal.status = status;
  }
  if (columns.confidence && goal.confidence === undefined) {
    const confidence = measure(row[columns.confidence]);
    if (confidence !== undefined) goal.confidence = confidence;
  }
  if (columns.priority && goal.priority === undefined) {
    const priority = text(row[columns.priority]);
    if (priority) goal.priority = priority.toUpperCase();
  }
  if (columns.agents && goal.total === undefined) {
    const total = num(row[columns.agents]);
    if (total !== undefined) goal.total = Math.max(0, Math.round(total));
  }
}

function readClaim(goal: string, said: string, age: number, row: Record<string, unknown>, columns: Columns): Claim {
  const claim: Claim = { goal, claim: said, age };
  for (const field of ['id', 'also', 'theme', 'agent', 'asset'] as const) {
    const key = columns[field];
    const value = key ? text(row[key]) : '';
    if (value) claim[field] = value;
  }
  for (const field of ['polarity', 'state'] as const) {
    const key = columns[field];
    const value = key ? text(row[key]).toLowerCase() : '';
    if (value) claim[field] = value;
  }
  const type = columns.type ? text(row[columns.type]).toLowerCase() : '';
  if (CLAIM_TYPES.has(type)) claim.type = type;
  for (const field of ['sources', 'records'] as const) {
    const key = columns[field];
    const value = key ? num(row[key]) : undefined;
    if (value !== undefined) claim[field] = Math.max(0, Math.round(value));
  }
  const weight = columns.weight ? measure(row[columns.weight]) : undefined;
  if (weight !== undefined) claim.weight = weight;
  return claim;
}

/**
 * The claim, goal and age columns, plus the optional ones. The goal a claim
 * names is its id or code where one is sent, and its name otherwise.
 */
function readColumns(rows: Record<string, unknown>[]): Columns | null {
  // Every row's keys: an optional column may be absent from the first rows of a JSON payload.
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const taken: string[] = [];
  const find = (set: ReadonlySet<string>) => {
    const key = keys.find((name) => set.has(normalizeName(name)) && !taken.includes(name));
    if (key) taken.push(key);
    return key;
  };

  const goal = find(GOAL_ID_KEYS) ?? find(GOAL_KEYS);
  const claim = find(CLAIM_KEYS);
  const age = find(AGE_KEYS);
  if (!goal || !claim || !age) return null;
  return {
    goal,
    claim,
    age,
    ...optional('goalName', find(GOAL_NAME_KEYS)),
    ...optional('status', find(GOAL_STATUS_KEYS)),
    ...optional('confidence', find(CONFIDENCE_KEYS)),
    ...optional('priority', find(PRIORITY_KEYS)),
    ...optional('agents', find(AGENT_TOTAL_KEYS)),
    ...optional('id', find(CLAIM_ID_KEYS)),
    ...optional('also', find(ALSO_KEYS)),
    ...optional('theme', find(THEME_KEYS)),
    ...optional('polarity', find(POLARITY_KEYS)),
    ...optional('state', find(CLAIM_STATE_KEYS)),
    ...optional('type', find(CLAIM_TYPE_KEYS)),
    ...optional('sources', find(SOURCES_KEYS)),
    ...optional('records', find(RECORDS_KEYS)),
    ...optional('weight', find(WEIGHT_KEYS)),
    ...optional('agent', find(FILED_BY_KEYS)),
    ...optional('asset', find(ASSET_KEYS)),
    ...optional('title', find(TITLE_KEYS)),
  };
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
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const n = Number(value.trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** A share as sent: 0.81, 81 or "81%". The widget reads all three. */
function measure(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const raw = text(value);
  if (!raw) return undefined;
  if (/^-?\d+(\.\d+)?%$/.test(raw)) return raw;
  return num(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
