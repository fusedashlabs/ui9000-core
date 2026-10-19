/**
 * Goals perimeter object for `<ui9000-goals-perimeter>` (AM-2).
 *
 * Many agents (or resources) arranged around a shared goal: one row per agent
 * with its id, its health state and the goal it works toward. Optional
 * columns add a link target per agent (a dependency, another agent, or a
 * goal), a reason, a blocker kind, and an exception count per goal.
 *
 * The reading is perimeter and population health, so the rows fit only when
 * every agent has a health state the widget can draw and the goals are few
 * against many agents. A free-form adjacency list (`source,target`) has no
 * goal or state and stays network-graph.
 */

const AGENT_KEYS = new Set([
  'agent',
  'agentid',
  'agentname',
  'node',
  'nodeid',
  'worker',
  'workerid',
  'bot',
  'botid',
  'resource',
  'resourceid',
  'id',
]);
const STATE_KEYS = new Set([
  'state',
  'status',
  'health',
  'healthstate',
  'agentstate',
  'agentstatus',
  'nodestate',
  'nodestatus',
]);
const GOAL_KEYS = new Set(['goal', 'goalid', 'goalname', 'objective', 'mission', 'sharedgoal']);
const LINK_KEYS = new Set([
  'dependson',
  'dependency',
  'linkedto',
  'linksto',
  'connectsto',
  'target',
  'to',
  'upstream',
  'calls',
]);
const LINK_STATUS_KEYS = new Set(['linkstatus', 'dependencystatus', 'connectionstatus', 'edgestatus']);
const REASON_KEYS = new Set(['reason', 'cause', 'error', 'detail', 'details', 'note']);
const BLOCKER_KEYS = new Set(['blocker', 'blockertype', 'blockedby']);
const EXCEPTION_KEYS = new Set(['exceptions', 'exceptioncount', 'impure', 'needsattention']);
const TITLE_KEYS = new Set(['title']);

/** Health words → the widget's agent states. */
const STATES: Record<string, AgentState> = {
  healthy: 'healthy',
  ok: 'healthy',
  success: 'healthy',
  active: 'healthy',
  running: 'healthy',
  online: 'healthy',
  up: 'healthy',
  degraded: 'degraded',
  warning: 'degraded',
  warn: 'degraded',
  slow: 'degraded',
  blocked: 'blocked',
  waiting: 'blocked',
  held: 'blocked',
  pending: 'blocked',
  failed: 'failed',
  failure: 'failed',
  error: 'failed',
  crashed: 'failed',
  down: 'failed',
  offline: 'failed',
  unavailable: 'failed',
  idle: 'idle',
  inactive: 'idle',
  paused: 'idle',
  stopped: 'idle',
};
const BLOCKERS: Record<string, 'rule' | 'dependency' | 'human'> = {
  rule: 'rule',
  policy: 'rule',
  dependency: 'dependency',
  upstream: 'dependency',
  human: 'human',
  approval: 'human',
  manual: 'human',
};

/** Fewer agents than this is a list, not a population. */
const MIN_AGENTS = 6;
/** More goals than this is a comparison of goals, not agents around one. */
const MAX_GOALS = 8;
/** Each goal needs this many agents on average to be a perimeter. */
const MIN_AGENTS_PER_GOAL = 3;
/** Share of rows whose state must be a health word. */
const STATE_COVERAGE = 0.9;

type AgentState = 'healthy' | 'degraded' | 'blocked' | 'failed' | 'idle';

type Columns = {
  agent: string;
  state: string;
  goal: string;
  link?: string;
  linkStatus?: string;
  reason?: string;
  blocker?: string;
  exceptions?: string;
  title?: string;
};

type Agent = {
  id: string;
  state: AgentState;
  goal: string;
  reason?: string;
  blocker?: 'rule' | 'dependency' | 'human';
};

type Perimeter = {
  title?: string;
  goals: { name: string; exceptionCount?: number }[];
  agents: Agent[];
  links: { source: string; target: string; status?: string }[];
  exceptionCount: number;
};

export function goalsPerimeterPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const perimeter = readPerimeter(rows);
  if (!perimeter) return null;
  const out: Record<string, unknown> = { chartType: 'goalsPerimeter' };
  if (perimeter.title) out.name = perimeter.title;
  out.goals = perimeter.goals;
  out.agents = perimeter.agents;
  if (perimeter.links.length > 0) out.links = perimeter.links;
  out.exceptionCount = perimeter.exceptionCount;
  return out;
}

/**
 * True when the rows are agents around shared goals: an agent, a health
 * state and a goal on every row, few goals against many agents. A plain
 * node–link list stays network-graph.
 */
export function goalsPerimeterFits(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false;
  return readPerimeter(payload.filter(isRecord)) !== null;
}

function readPerimeter(rows: Record<string, unknown>[]): Perimeter | null {
  if (rows.length < MIN_AGENTS) return null;
  const columns = readColumns(rows);
  if (!columns) return null;

  const agents = new Map<string, Agent>();
  const goals = new Map<string, { name: string; exceptionCount?: number }>();
  const links: Perimeter['links'] = [];
  let stated = 0;

  for (const row of rows) {
    const id = text(row[columns.agent]);
    const goal = text(row[columns.goal]);
    const stateWord = text(row[columns.state]);
    if (!id || !goal) return null;
    const state = stateWord ? STATES[stateWord.toLowerCase().replace(/[\s_-]+/g, '')] : 'healthy';
    if (state) stated += 1;

    if (!goals.has(goal.toLowerCase())) goals.set(goal.toLowerCase(), { name: goal });
    const known = goals.get(goal.toLowerCase())!;
    if (columns.exceptions && known.exceptionCount === undefined) {
      const count = num(row[columns.exceptions]);
      if (count !== undefined) known.exceptionCount = Math.max(0, Math.round(count));
    }

    const existing = agents.get(id);
    if (existing) {
      // A repeated agent is another link of the same agent; anything else is not one population.
      if (!columns.link || existing.goal !== goal) return null;
    } else {
      const agent: Agent = { id, state: state ?? 'idle', goal };
      const reason = columns.reason ? text(row[columns.reason]) : '';
      if (reason && agent.state !== 'healthy') agent.reason = reason;
      const blocker = columns.blocker ? BLOCKERS[text(row[columns.blocker]).toLowerCase()] : undefined;
      if (blocker && agent.state === 'blocked') agent.blocker = blocker;
      agents.set(id, agent);
    }

    if (columns.link) {
      const target = text(row[columns.link]);
      if (target && target !== id) {
        const status = columns.linkStatus ? text(row[columns.linkStatus]).toLowerCase() : '';
        links.push({ source: id, target, ...(status ? { status } : {}) });
      }
    }
  }

  if (stated / rows.length < STATE_COVERAGE) return null;
  if (agents.size < MIN_AGENTS) return null;
  if (goals.size > MAX_GOALS || agents.size / goals.size < MIN_AGENTS_PER_GOAL) return null;

  const all = [...agents.values()];
  const counted = [...goals.values()].filter((goal) => goal.exceptionCount !== undefined);
  const exceptionCount =
    counted.length === goals.size
      ? counted.reduce((sum, goal) => sum + goal.exceptionCount!, 0)
      : all.filter((agent) => agent.state === 'degraded' || agent.state === 'blocked' || agent.state === 'failed')
          .length;
  const title = columns.title ? sameText(rows, columns.title) : undefined;

  return {
    ...(title ? { title } : {}),
    goals: [...goals.values()],
    agents: all,
    links,
    exceptionCount,
  };
}

/**
 * The agent, state and goal columns, plus the optional ones. A `source`
 * column is the agent only when its `target` pair is there to be the link.
 */
function readColumns(rows: Record<string, unknown>[]): Columns | null {
  // Every row's keys: an optional column may be absent from the first rows of a JSON payload.
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const find = (set: ReadonlySet<string>, skip: readonly (string | undefined)[] = []) =>
    keys.find((key) => set.has(normalize(key)) && !skip.includes(key));

  const goal = find(GOAL_KEYS);
  const state = find(STATE_KEYS);
  if (!goal || !state) return null;
  const hasPair = keys.some((key) => normalize(key) === 'source') && keys.some((key) => normalize(key) === 'target');
  const agent = find(AGENT_KEYS) ?? (hasPair ? keys.find((key) => normalize(key) === 'source') : undefined);
  if (!agent) return null;
  const taken = [goal, state, agent];
  const link = find(LINK_KEYS, taken);
  return {
    agent,
    state,
    goal,
    ...(link ? { link } : {}),
    ...optional('linkStatus', find(LINK_STATUS_KEYS, taken)),
    ...optional('reason', find(REASON_KEYS, taken)),
    ...optional('blocker', find(BLOCKER_KEYS, taken)),
    ...optional('exceptions', find(EXCEPTION_KEYS, taken)),
    ...optional('title', find(TITLE_KEYS, taken)),
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

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
