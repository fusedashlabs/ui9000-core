/**
 * Goals dependency graph object for `<ui9000-goals-dependency-graph>` (FUS-4233).
 *
 * Every goal a tree of its agents on a baseline, the resource groups in a
 * row over the trees, and a line from each goal to every group it draws on
 * in the colour of the agents it holds there; the worst line is traced with
 * a callout naming the cause, the rule, the owner and how long it has held
 * them. One row per goal and group, with the goal's agent total on every
 * goal and the calls or held agents on the pair; optional goal columns
 * (code, agents by state, progress, burn, status) and pair columns (kind,
 * state, detail, cause, rule, owner, since).
 *
 * The reading is what holds each goal's agents, so a link must hold agents
 * or a row must trace a hold. Up to eight goals are drawn. A free-form
 * adjacency list (`source,target`) stays network-graph.
 */

import { readGoalGroups, type GoalGroupMap } from './goal-groups.js';

/** The widget draws up to eight goals. */
const MAX_GOALS = 8;

export function goalsDependencyGraphPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const map = readDependencies(rows);
  if (!map) return null;
  return {
    chartType: 'goalsDependencyGraph',
    ...(map.title ? { name: map.title } : {}),
    goals: map.goals,
  };
}

/**
 * True when the rows are a few goals against the resource groups they draw
 * on, and something holds their agents there.
 */
export function goalsDependencyGraphFits(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false;
  return readDependencies(payload.filter(isRecord)) !== null;
}

function readDependencies(rows: Record<string, unknown>[]): GoalGroupMap | null {
  const map = readGoalGroups(rows);
  if (!map || map.goals.length > MAX_GOALS) return null;
  if (!map.holds && !map.traced) return null;
  return map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
