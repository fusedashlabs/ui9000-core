/**
 * Column names (normalized) that describe goals against the resource groups
 * they draw on: one row per goal and group, with the calls a minute the goal
 * makes there or the agents it has held there. Goal columns (code, agents by
 * state, progress, burn, status) repeat on each of the goal's rows; group
 * columns (kind, state, held, calls, detail, and the hold's cause, rule,
 * owner and since) belong to the pair.
 *
 * Shared by the family gate in discuss-chart (names only) and the payload
 * readers (names and values), so the two cannot drift apart. A bare `group`
 * or `resource` is not a resource group: too many tables group by something.
 */

import { GOAL_KEYS } from './perimeter-columns.js';
import { normalizeName } from './table.js';

export { GOAL_KEYS };

export const GROUP_KEYS = new Set([
  'resourcegroup',
  'resourcegroupname',
  'resourcegroupid',
  'resourcegroups',
  'assetgroup',
  'assetgroupname',
]);
export const CALLS_KEYS = new Set(['calls', 'callsperminute', 'callspermin', 'callsamin', 'cpm']);
export const HELD_KEYS = new Set(['held', 'heldagents', 'agentsheld']);
export const LINK_STATE_KEYS = new Set([
  'state',
  'status',
  'groupstate',
  'groupstatus',
  'linkstate',
  'linkstatus',
  'trafficstate',
]);
export const KIND_KEYS = new Set(['kind', 'groupkind', 'resourcekind', 'resourcetype', 'grouptype']);
export const DETAIL_KEYS = new Set(['detail', 'details']);
/** What holds agents on a group: the dependency graph traces these, the bipartite graph does not read them. */
export const CAUSE_KEYS = new Set(['cause', 'holdcause']);
export const RULE_KEYS = new Set(['rule', 'ruleid']);
export const OWNER_KEYS = new Set(['owner', 'groupowner']);
export const SINCE_KEYS = new Set(['since', 'heldsince', 'heldfor']);

export const GOAL_CODE_KEYS = new Set(['goalcode', 'code']);
export const GOAL_STATUS_KEYS = new Set(['goalstatus', 'goalstate']);
export const PROGRESS_KEYS = new Set(['progress', 'goalprogress', 'goalhealth']);
export const BURN_KEYS = new Set(['burn', 'multiplier', 'tokenburn']);
export const AGENT_TOTAL_KEYS = new Set(['agents', 'agenttotal', 'totalagents', 'agentcount']);
/** The goal's agents by state, as the widgets count them. */
export const AGENT_STATE_KEYS = {
  healthy: new Set(['healthy', 'working', 'atwork']),
  idle: new Set(['idle']),
  awaiting: new Set(['awaiting', 'waiting']),
  blocked: new Set(['blocked']),
  failed: new Set(['failed']),
  degraded: new Set(['degraded', 'overbudget']),
} as const;
export const TITLE_KEYS = new Set(['title']);

/** A goal and a resource group are named, with the calls or the agents held between them. */
export function namesGoalGroups(keys: readonly string[]): boolean {
  const present = new Set(keys.map(normalizeName));
  const has = (set: ReadonlySet<string>) => [...present].some((key) => set.has(key));
  return has(GOAL_KEYS) && has(GROUP_KEYS) && (has(CALLS_KEYS) || has(HELD_KEYS));
}

/** Goals against their groups with the goals' agents by state, healthy ones included: the goals perimeter's population health. */
export function namesGoalHealth(keys: readonly string[]): boolean {
  const present = new Set(keys.map(normalizeName));
  return namesGoalGroups(keys) && [...present].some((key) => AGENT_STATE_KEYS.healthy.has(key));
}
