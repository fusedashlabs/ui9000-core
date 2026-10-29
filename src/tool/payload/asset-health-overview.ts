/**
 * Asset health overview object for `<ui9000-asset-health-overview>`.
 *
 * Needs an agent population (one goal) plus asset categories with health
 * counts or problems. What the goal rings arena reads besides is passed on as
 * sent: the goal's working, idle, over-budget, progress and status, and per
 * category its held agents, calls, traffic, rules and 24-hour `day`. Nothing
 * is invented. A single health dial stays the status gauge. A plain number
 * stays the KPI. Free-form node–link stays the network graph.
 */

const AGENT_TOTAL_KEYS =
  /^(agents?|agent_?total|agent_?count|total_?agents?|population)$/i;
const AWAITING_KEYS = /^(awaiting|needs_?input|waiting)$/i;
const BLOCKED_KEYS = /^blocked$/i;
const FAILED_KEYS = /^(failed|failing_?agents?)$/i;
const BURN_KEYS = /^burn$/i;
const OVER_BUDGET_KEYS = /^over_?budget$/i;
const CATEGORY_KEYS = /^(category|asset_?category|name|label|group)$/i;
const TOTAL_KEYS = /^(total|assets?|count|n)$/i;
const HEALTHY_KEYS = /^(healthy|ok|good|green)$/i;
const DEGRADED_KEYS = /^(degraded|warn|warning|amber)$/i;
const FAILING_KEYS = /^(failing|failed_?assets?|critical|impaired|red)$/i;
const PROBLEMS_KEYS = /^(problems|issues)$/i;

type Problem = {
  name: string;
  type?: string;
  why?: string;
  loc?: string;
  where?: string;
  sev?: string;
  state?: string;
  agents?: number;
  since?: number;
  rule?: string;
};

type Category = {
  id?: string;
  name: string;
  total?: number;
  healthy?: number;
  degraded?: number;
  failing?: number;
  items?: string[];
  problems?: Problem[];
  unit?: string;
  unitOne?: string;
  crew?: number;
  held?: number;
  hold?: string;
  overBudget?: number;
  calls?: number;
  traffic?: Record<string, number | string>;
  heldUp?: number | string;
  rules?: string[];
  day?: unknown[];
};

type Agents = {
  id?: string;
  name?: string;
  total: number;
  awaiting?: number;
  blocked?: number;
  failed?: number;
  burn?: number;
  code?: string;
  working?: number;
  idle?: number;
  overBudget?: number;
  progress?: number | string;
  status?: string;
};

type Overview = {
  name?: string;
  agents: Agents;
  categories: Category[];
};

export function assetHealthOverviewPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const overview = readOverview(rows);
  if (!overview) return null;

  return {
    chartType: 'assetHealthOverview',
    ...(overview.name ? { name: overview.name } : {}),
    agents: overview.agents,
    categories: overview.categories,
  };
}

/**
 * True when the overview should replace a KPI: an agent population plus at
 * least two asset categories that already carry health counts or problems.
 */
export function assetHealthFits(payload: unknown): boolean {
  if (isRecord(payload) && !Array.isArray(payload)) {
    return readOverviewFromObject(payload) !== null;
  }
  if (!Array.isArray(payload)) return false;
  return readOverview(payload.filter(isRecord)) !== null;
}

function readOverview(rows: Record<string, unknown>[]): Overview | null {
  if (rows.length === 1 && isOverviewObject(rows[0]!)) {
    return readOverviewFromObject(rows[0]!);
  }
  return readOverviewFromRows(rows);
}

function isOverviewObject(row: Record<string, unknown>): boolean {
  // `name` is the chart title on a WidgetItem and the category name on a row.
  // Nested agents, goal, categories, or data is what makes this the overview.
  return (
    isRecord(row.agents) ||
    isRecord(row.goal) ||
    Array.isArray(row.categories) ||
    Array.isArray(row.data)
  );
}

function readOverviewFromObject(raw: Record<string, unknown>): Overview | null {
  const categorySource = Array.isArray(raw.categories)
    ? raw.categories
    : Array.isArray(raw.data)
      ? raw.data
      : [];
  const categories = categorySource.map(readCategory).filter((c): c is Category => !!c);
  if (categories.length < 2) return null;
  if (!categories.every(hasHealthSignal)) return null;

  const agents =
    readAgents(raw.agents) ??
    readAgents(raw.goal) ??
    (Array.isArray(raw.data)
      ? readAgentsFromRows(raw.data.filter(isRecord))
      : null) ??
    readAgents(raw);
  if (!agents) return null;

  // The widget paints payload.name over goal.name. A category row's name is not a title.
  const title = text(raw.name) || text(raw.title) || text(raw.description);
  if (title) agents.name = title;

  return { agents, categories, ...(title ? { name: title } : {}) };
}

function readOverviewFromRows(rows: Record<string, unknown>[]): Overview | null {
  if (rows.length < 2) return null;
  const categories = rows.map(readCategory).filter((c): c is Category => !!c);
  if (categories.length < 2 || categories.length !== rows.length) return null;
  if (!categories.every(hasHealthSignal)) return null;

  const agents = readAgentsFromRows(rows);
  if (!agents) return null;

  return { agents, categories };
}

function readAgentsFromRows(rows: Record<string, unknown>[]): Agents | null {
  const agentsRow = rows.find((row) => num(cell(row, AGENT_TOTAL_KEYS)) !== undefined) ?? rows[0];
  if (!agentsRow) return null;
  const total = num(cell(agentsRow, AGENT_TOTAL_KEYS));
  if (total === undefined) return null;

  return {
    total,
    ...(num(cell(agentsRow, AWAITING_KEYS)) !== undefined
      ? { awaiting: num(cell(agentsRow, AWAITING_KEYS)) }
      : {}),
    ...(num(cell(agentsRow, BLOCKED_KEYS)) !== undefined
      ? { blocked: num(cell(agentsRow, BLOCKED_KEYS)) }
      : {}),
    ...(num(cell(agentsRow, FAILED_KEYS)) !== undefined
      ? { failed: num(cell(agentsRow, FAILED_KEYS)) }
      : {}),
    ...(num(cell(agentsRow, BURN_KEYS)) !== undefined
      ? { burn: num(cell(agentsRow, BURN_KEYS)) }
      : {}),
  };
}

/** The goal's own reading as the arena draws it, kept only where sent. */
function readGoalExtras(raw: Record<string, unknown>): Partial<Agents> {
  const code = text(raw.code);
  const working = num(raw.working);
  const idle = num(raw.idle);
  const overBudget = num(raw.overBudget) ?? num(cell(raw, OVER_BUDGET_KEYS));
  const progress = measure(raw.progress);
  const status = text(raw.status);
  return {
    ...(code ? { code } : {}),
    ...(working !== undefined ? { working } : {}),
    ...(idle !== undefined ? { idle } : {}),
    ...(overBudget !== undefined ? { overBudget } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(status ? { status } : {}),
  };
}

function readAgents(raw: unknown): Agents | null {
  if (!isRecord(raw)) return null;
  const total = num(raw.total) ?? num(cell(raw, AGENT_TOTAL_KEYS));
  if (total === undefined) return null;
  const id = text(raw.id);
  const name = text(raw.name);
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    total,
    ...(num(raw.awaiting) !== undefined || num(cell(raw, AWAITING_KEYS)) !== undefined
      ? { awaiting: num(raw.awaiting) ?? num(cell(raw, AWAITING_KEYS)) }
      : {}),
    ...(num(raw.blocked) !== undefined || num(cell(raw, BLOCKED_KEYS)) !== undefined
      ? { blocked: num(raw.blocked) ?? num(cell(raw, BLOCKED_KEYS)) }
      : {}),
    ...(num(raw.failed) !== undefined || num(cell(raw, FAILED_KEYS)) !== undefined
      ? { failed: num(raw.failed) ?? num(cell(raw, FAILED_KEYS)) }
      : {}),
    ...(num(raw.burn) !== undefined || num(cell(raw, BURN_KEYS)) !== undefined
      ? { burn: num(raw.burn) ?? num(cell(raw, BURN_KEYS)) }
      : {}),
    ...readGoalExtras(raw),
  };
}

function readCategory(value: unknown): Category | null {
  if (!isRecord(value)) return null;
  const name = text(cell(value, CATEGORY_KEYS)) || text(value.name) || text(value.id);
  if (!name) return null;
  const problems = Array.isArray(value.problems)
    ? value.problems.map(readProblem).filter((p): p is Problem => !!p)
    : Array.isArray(cell(value, PROBLEMS_KEYS))
      ? (cell(value, PROBLEMS_KEYS) as unknown[])
          .map(readProblem)
          .filter((p): p is Problem => !!p)
      : undefined;
  const healthy = num(cell(value, HEALTHY_KEYS) ?? value.healthy);
  const degraded = num(cell(value, DEGRADED_KEYS) ?? value.degraded);
  // Bare `failed` is the agent failure column on WidgetItem rows — not assets.
  const failing = num(cell(value, FAILING_KEYS) ?? value.failing);
  const total = num(cell(value, TOTAL_KEYS) ?? value.total);
  const items = Array.isArray(value.items)
    ? value.items.map(text).filter((s): s is string => !!s)
    : undefined;
  return {
    ...(text(value.id) ? { id: text(value.id) } : {}),
    name,
    ...(total !== undefined ? { total } : {}),
    ...(healthy !== undefined ? { healthy } : {}),
    ...(degraded !== undefined ? { degraded } : {}),
    ...(failing !== undefined ? { failing } : {}),
    ...(items ? { items } : {}),
    ...(problems ? { problems } : {}),
    ...readArenaFields(value),
  };
}

/** What the arena reads of a category besides its health: kept only where sent, never invented. */
function readArenaFields(value: Record<string, unknown>): Partial<Category> {
  const unit = text(value.unit);
  const unitOne = text(value.unitOne);
  const crew = num(value.crew);
  const held = num(value.held);
  const hold = text(value.hold);
  const overBudget = num(value.overBudget);
  const calls = num(value.calls) ?? num(value.cpm);
  const traffic = isRecord(value.traffic)
    ? Object.fromEntries(
        Object.entries(value.traffic).flatMap(([state, share]) => {
          const kept = measure(share);
          return kept === undefined ? [] : [[state, kept]];
        }),
      )
    : undefined;
  const heldUp = measure(value.heldUp);
  const rules = Array.isArray(value.rules)
    ? value.rules.map(text).filter((s): s is string => !!s)
    : undefined;
  const day = Array.isArray(value.day) ? value.day : undefined;
  return {
    ...(unit ? { unit } : {}),
    ...(unitOne ? { unitOne } : {}),
    ...(crew !== undefined ? { crew } : {}),
    ...(held !== undefined ? { held } : {}),
    ...(hold ? { hold } : {}),
    ...(overBudget !== undefined ? { overBudget } : {}),
    ...(calls !== undefined ? { calls } : {}),
    ...(traffic ? { traffic } : {}),
    ...(heldUp !== undefined ? { heldUp } : {}),
    ...(rules?.length ? { rules } : {}),
    ...(day ? { day } : {}),
  };
}

function readProblem(value: unknown): Problem | null {
  if (!isRecord(value)) return null;
  const name = text(value.name);
  if (!name) return null;
  const agents = num(value.agents);
  const since = num(value.since);
  return {
    name,
    ...(text(value.type) ? { type: text(value.type) } : {}),
    ...(text(value.why) ? { why: text(value.why) } : {}),
    ...(text(value.loc) ? { loc: text(value.loc) } : {}),
    ...(text(value.where) ? { where: text(value.where) } : {}),
    ...(text(value.sev) ? { sev: text(value.sev) } : {}),
    ...(text(value.state) ? { state: text(value.state) } : {}),
    ...(agents !== undefined ? { agents } : {}),
    ...(since !== undefined ? { since } : {}),
    ...(text(value.rule) ? { rule: text(value.rule) } : {}),
  };
}

function hasHealthSignal(category: Category): boolean {
  return (
    category.healthy !== undefined ||
    category.degraded !== undefined ||
    category.failing !== undefined ||
    (category.problems !== undefined && category.total !== undefined) ||
    (category.items !== undefined && category.total !== undefined) ||
    // how the goal fares with the category, as the goal rings arena reads it
    category.traffic !== undefined ||
    category.day !== undefined ||
    category.hold !== undefined ||
    category.held !== undefined
  );
}

function keyOf(row: Record<string, unknown>, pattern: RegExp): string | undefined {
  return Object.keys(row).find((name) => pattern.test(name));
}

function cell(row: Record<string, unknown>, pattern: RegExp): unknown {
  const key = keyOf(row, pattern);
  return key ? row[key] : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** A share or percent as sent (`0.41`, `41`, `"41%"`): the widget reads all three. */
function measure(value: unknown): number | string | undefined {
  return num(value) ?? text(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
