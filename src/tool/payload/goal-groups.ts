/**
 * Goals against the resource groups they draw on, read from one row per goal
 * and group. The goals perimeter's goal shape, as the bipartite graph and the
 * goals dependency graph take it: each goal with its agents and the groups it
 * draws on, a group of the same name on several goals being one group.
 *
 * Goal columns repeat on each of the goal's rows; the first value sent wins.
 * Nothing is invented: a column that is not sent is not in the payload.
 */

import {
  AGENT_STATE_KEYS,
  AGENT_TOTAL_KEYS,
  BURN_KEYS,
  CALLS_KEYS,
  CAUSE_KEYS,
  DETAIL_KEYS,
  GOAL_CODE_KEYS,
  GOAL_KEYS,
  GOAL_STATUS_KEYS,
  GROUP_KEYS,
  HELD_KEYS,
  KIND_KEYS,
  LINK_STATE_KEYS,
  OWNER_KEYS,
  PROGRESS_KEYS,
  RULE_KEYS,
  SINCE_KEYS,
  TITLE_KEYS,
} from '../../profiler/goal-group-columns.js';
import { normalizeName } from '../../profiler/table.js';

/** How the goal fares with the group → the widgets' link states. */
const LINK_STATES: Record<string, LinkState> = {
  healthy: 'healthy',
  ok: 'healthy',
  success: 'healthy',
  active: 'healthy',
  running: 'healthy',
  online: 'healthy',
  up: 'healthy',
  flowing: 'healthy',
  degraded: 'degraded',
  warning: 'degraded',
  warn: 'degraded',
  slow: 'degraded',
  slowed: 'degraded',
  throttled: 'degraded',
  awaiting: 'awaiting',
  waiting: 'awaiting',
  holding: 'awaiting',
  pending: 'awaiting',
  onhold: 'awaiting',
  blocked: 'blocked',
  held: 'blocked',
  failed: 'failed',
  failure: 'failed',
  error: 'failed',
  crashed: 'failed',
  down: 'failed',
  unavailable: 'failed',
  critical: 'failed',
};
/** Goal status words both widgets read; anything else is left for the progress to say. */
const GOAL_STATUSES = new Set([
  'healthy',
  'degraded',
  'critical',
  'ok',
  'warning',
  'error',
  'failed',
  'on track',
  'at risk',
  'off track',
  'blocked',
]);
const HELD_STATES = new Set<LinkState>(['awaiting', 'blocked', 'failed']);

type LinkState = 'healthy' | 'degraded' | 'awaiting' | 'blocked' | 'failed';
type AgentState = keyof typeof AGENT_STATE_KEYS;

export type GroupLink = {
  name: string;
  kind?: string;
  state?: LinkState;
  held?: number;
  calls?: number;
  detail?: string;
  cause?: string;
  rule?: string;
  owner?: string;
  since?: string;
};

export type GoalAgents = { total: number } & Partial<Record<AgentState, number>>;

export type GoalGroups = {
  name: string;
  code?: string;
  agents: GoalAgents;
  progress?: number | string;
  multiplier?: number;
  status?: string;
  resourceGroups: GroupLink[];
};

export type GoalGroupMap = {
  title?: string;
  goals: GoalGroups[];
  /** Every link carries its calls a minute. */
  callsOnEveryLink: boolean;
  /** Some link holds agents: a held count, or a held state. */
  holds: boolean;
  /** Some link says what holds agents there: a cause, rule, owner or since. */
  traced: boolean;
};

type Columns = {
  goal: string;
  group: string;
  calls?: string;
  held?: string;
  state?: string;
  kind?: string;
  detail?: string;
  cause?: string;
  rule?: string;
  owner?: string;
  since?: string;
  code?: string;
  status?: string;
  progress?: string;
  burn?: string;
  agents?: string;
  title?: string;
  states: Partial<Record<AgentState, string>>;
};

/**
 * The goals and their groups, or null unless the rows are goal × group pairs
 * with the goal's agent total on every goal, and at least two goals. A pair
 * that repeats is not one link.
 */
export function readGoalGroups(rows: Record<string, unknown>[]): GoalGroupMap | null {
  if (rows.length < 2) return null;
  const columns = readColumns(rows);
  if (!columns) return null;

  const goals = new Map<string, Reading>();
  let called = 0;
  let holds = false;
  let traced = false;

  for (const row of rows) {
    const goalName = text(row[columns.goal]);
    const groupName = text(row[columns.group]);
    if (!goalName || !groupName) return null;

    const key = goalName.toLowerCase();
    let goal = goals.get(key);
    if (!goal) {
      goal = { name: goalName, agents: {}, resourceGroups: [], seen: new Set() };
      goals.set(key, goal);
    }
    readGoalColumns(goal, row, columns);

    if (goal.seen.has(groupName.toLowerCase())) return null;
    goal.seen.add(groupName.toLowerCase());

    const link = readLink(groupName, row, columns);
    if (link.calls !== undefined) called += 1;
    if ((link.held ?? 0) > 0 || (link.state && HELD_STATES.has(link.state))) holds = true;
    if (link.cause || link.rule || link.owner || link.since) traced = true;
    goal.resourceGroups.push(link);
  }

  if (goals.size < 2) return null;
  const read: GoalGroups[] = [];
  for (const { seen, agents, ...goal } of goals.values()) {
    void seen;
    if (agents.total === undefined) return null;
    read.push({ ...goal, agents: { ...agents, total: agents.total } });
  }

  const title = columns.title ? sameText(rows, columns.title) : undefined;
  return {
    ...(title ? { title } : {}),
    goals: read,
    callsOnEveryLink: called === rows.length,
    holds,
    traced,
  };
}

/** A goal while its rows are read: its agent total may come on a later row. */
type Reading = Omit<GoalGroups, 'agents'> & { agents: Partial<GoalAgents>; seen: Set<string> };

function readGoalColumns(goal: Reading, row: Record<string, unknown>, columns: Columns): void {
  if (columns.agents && goal.agents.total === undefined) {
    const total = num(row[columns.agents]);
    if (total !== undefined) goal.agents.total = Math.max(0, Math.round(total));
  }
  for (const [state, key] of Object.entries(columns.states) as [AgentState, string][]) {
    if (goal.agents[state] !== undefined) continue;
    const count = num(row[key]);
    if (count !== undefined) goal.agents[state] = Math.max(0, Math.round(count));
  }
  if (columns.code && goal.code === undefined) {
    const code = text(row[columns.code]);
    if (code) goal.code = code;
  }
  if (columns.status && goal.status === undefined) {
    const status = text(row[columns.status]).toLowerCase().replace(/[_-]+/g, ' ');
    if (GOAL_STATUSES.has(status)) goal.status = status;
  }
  if (columns.progress && goal.progress === undefined) {
    const progress = measure(row[columns.progress]);
    if (progress !== undefined) goal.progress = progress;
  }
  if (columns.burn && goal.multiplier === undefined) {
    const burn = num(String(row[columns.burn] ?? '').replace(/[×x]$/i, ''));
    if (burn !== undefined) goal.multiplier = burn;
  }
}

function readLink(name: string, row: Record<string, unknown>, columns: Columns): GroupLink {
  const link: GroupLink = { name };
  const kind = columns.kind ? text(row[columns.kind]) : '';
  if (kind) link.kind = kind.toLowerCase();
  const state = columns.state ? LINK_STATES[text(row[columns.state]).toLowerCase().replace(/[\s_-]+/g, '')] : undefined;
  if (state) link.state = state;
  const held = columns.held ? num(row[columns.held]) : undefined;
  if (held !== undefined) link.held = Math.max(0, Math.round(held));
  const calls = columns.calls ? num(row[columns.calls]) : undefined;
  if (calls !== undefined) link.calls = Math.max(0, calls);
  for (const field of ['detail', 'cause', 'rule', 'owner', 'since'] as const) {
    const key = columns[field];
    const value = key ? text(row[key]) : '';
    if (value) link[field] = value;
  }
  return link;
}

function readColumns(rows: Record<string, unknown>[]): Columns | null {
  // Every row's keys: an optional column may be absent from the first rows of a JSON payload.
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const taken: string[] = [];
  const find = (set: ReadonlySet<string>) => {
    const key = keys.find((name) => set.has(normalizeName(name)) && !taken.includes(name));
    if (key) taken.push(key);
    return key;
  };

  const goal = find(GOAL_KEYS);
  const group = find(GROUP_KEYS);
  if (!goal || !group) return null;
  const calls = find(CALLS_KEYS);
  const held = find(HELD_KEYS);
  if (!calls && !held) return null;

  const states: Columns['states'] = {};
  for (const [state, set] of Object.entries(AGENT_STATE_KEYS) as [AgentState, ReadonlySet<string>][]) {
    const key = find(set);
    if (key) states[state] = key;
  }
  return {
    goal,
    group,
    states,
    ...optional('calls', calls),
    ...optional('held', held),
    ...optional('agents', find(AGENT_TOTAL_KEYS)),
    ...optional('code', find(GOAL_CODE_KEYS)),
    ...optional('status', find(GOAL_STATUS_KEYS)),
    ...optional('progress', find(PROGRESS_KEYS)),
    ...optional('burn', find(BURN_KEYS)),
    ...optional('state', find(LINK_STATE_KEYS)),
    ...optional('kind', find(KIND_KEYS)),
    ...optional('detail', find(DETAIL_KEYS)),
    ...optional('cause', find(CAUSE_KEYS)),
    ...optional('rule', find(RULE_KEYS)),
    ...optional('owner', find(OWNER_KEYS)),
    ...optional('since', find(SINCE_KEYS)),
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

/** A share as sent: 0.88, 88 or "88%". The widgets read all three. */
function measure(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const raw = text(value);
  if (!raw) return undefined;
  if (/^-?\d+(\.\d+)?%$/.test(raw)) return raw;
  return num(raw);
}
