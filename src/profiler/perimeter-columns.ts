/**
 * Column names (normalized) that describe agents around a shared goal: an
 * agent, its health state and its goal, plus optional links, reasons,
 * blockers and exception counts.
 *
 * Shared by the family gate in discuss-chart (names only) and the payload
 * builder (names and values), so the two cannot drift apart. A bare `id` is
 * not an agent: a table of tasks or records with an id, a status and a goal
 * is too common to read as agents around a goal.
 */

import { normalizeName } from './table.js';

export const AGENT_KEYS = new Set([
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
]);
export const STATE_KEYS = new Set([
  'state',
  'status',
  'health',
  'healthstate',
  'agentstate',
  'agentstatus',
  'nodestate',
  'nodestatus',
]);
export const GOAL_KEYS = new Set(['goal', 'goalid', 'goalname', 'objective', 'mission', 'sharedgoal']);
export const LINK_KEYS = new Set([
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
export const LINK_STATUS_KEYS = new Set(['linkstatus', 'dependencystatus', 'connectionstatus', 'edgestatus']);
export const REASON_KEYS = new Set(['reason', 'cause', 'error', 'detail', 'details', 'note']);
export const BLOCKER_KEYS = new Set(['blocker', 'blockertype', 'blockedby']);
export const EXCEPTION_KEYS = new Set(['exceptions', 'exceptioncount', 'impure', 'needsattention']);
export const TITLE_KEYS = new Set(['title']);

/** A `source` column is the agent only when its `target` pair is there to be the link. */
export function namesAgentPair(keys: readonly string[]): boolean {
  const present = new Set(keys.map(normalizeName));
  return present.has('source') && present.has('target');
}

/** An agent, its state and its goal are named: the graph family's goals perimeter, with or without links. */
export function namesPerimeter(keys: readonly string[]): boolean {
  const present = new Set(keys.map(normalizeName));
  const has = (set: ReadonlySet<string>) => [...present].some((key) => set.has(key));
  return (has(AGENT_KEYS) || namesAgentPair(keys)) && has(STATE_KEYS) && has(GOAL_KEYS);
}
