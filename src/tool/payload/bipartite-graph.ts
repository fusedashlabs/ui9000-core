/**
 * Bipartite graph object for `<ui9000-bipartite-graph>` (FUS-4234).
 *
 * Goals in a column against the resource groups they draw on, a ribbon for
 * each pair as wide as the calls a minute the goal makes there, in the colour
 * of the agents held on it. One row per goal and group, with the goal's agent
 * total and the pair's calls on every row; optional goal columns (code,
 * agents by state, progress, burn, status) and pair columns (kind, state,
 * held, detail).
 *
 * The reading is how much each goal draws on each group, so every link needs
 * its calls. Rows that say what holds agents on a group (a cause, rule,
 * owner or since) trace a hold, which this chart does not draw. A free-form
 * adjacency list (`source,target`) stays network-graph.
 */

import { readGoalGroups, type GoalGroupMap } from './goal-groups.js';

export function bipartiteGraphPayload(
  _fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const map = readBipartite(rows);
  if (!map) return null;
  return {
    chartType: 'bipartiteGraph',
    ...(map.title ? { name: map.title } : {}),
    goals: map.goals.map(({ progress, resourceGroups, ...goal }) => ({
      ...goal,
      // The bipartite graph reads a goal's progress as its health.
      ...(progress !== undefined ? { health: progress } : {}),
      resourceGroups: resourceGroups.map(({ name, kind, state, held, calls, detail }) => ({
        name,
        ...(kind ? { kind } : {}),
        ...(state ? { state } : {}),
        ...(held !== undefined ? { held } : {}),
        ...(calls !== undefined ? { calls } : {}),
        ...(detail ? { detail } : {}),
      })),
    })),
  };
}

/**
 * True when the rows are goals against the resource groups they draw on,
 * with the calls on every link and no hold traced to its cause.
 */
export function bipartiteGraphFits(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false;
  return readBipartite(payload.filter(isRecord)) !== null;
}

function readBipartite(rows: Record<string, unknown>[]): GoalGroupMap | null {
  const map = readGoalGroups(rows);
  if (!map || !map.callsOnEveryLink || map.traced) return null;
  return map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
