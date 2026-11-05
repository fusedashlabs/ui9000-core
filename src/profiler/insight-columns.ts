/**
 * Column names (normalized) that describe the evidence behind goals: one row
 * per claim an agent filed, with the goal it was filed under and its age in
 * hours, plus optional stance, state, type, subject, sources, records,
 * weight, the agent and asset kind, and the other goals it bears on. Goal
 * columns (name, status, confidence, priority, agents) repeat on each of the
 * goal's claims.
 *
 * Shared by the family gate in discuss-chart (names only) and the payload
 * builder (names and values), so the two cannot drift apart.
 */

import { GOAL_KEYS } from './perimeter-columns.js';
import { normalizeName } from './table.js';

export { GOAL_KEYS };

/** The goal a claim names: its id or code first, as claims and connected goals name each other by it. */
export const GOAL_ID_KEYS = new Set(['goalid', 'goalcode', 'goal']);
export const GOAL_NAME_KEYS = new Set(['goalname', 'goaltitle']);
export const GOAL_STATUS_KEYS = new Set(['goalstatus', 'goalstate']);
export const CONFIDENCE_KEYS = new Set(['confidence', 'goalconfidence']);
export const PRIORITY_KEYS = new Set(['priority', 'goalpriority']);
export const AGENT_TOTAL_KEYS = new Set(['agents', 'agenttotal', 'totalagents', 'agentcount']);

export const CLAIM_KEYS = new Set(['claim', 'claimtext', 'insight', 'finding']);
export const CLAIM_ID_KEYS = new Set(['claimid', 'insightid', 'id']);
export const AGE_KEYS = new Set(['age', 'agehours', 'ageh', 'hoursago', 'hours']);
export const POLARITY_KEYS = new Set(['polarity', 'stance']);
export const CLAIM_STATE_KEYS = new Set(['state', 'status', 'claimstate', 'claimstatus']);
export const CLAIM_TYPE_KEYS = new Set(['type', 'claimtype', 'insighttype']);
export const THEME_KEYS = new Set(['theme', 'topic', 'subject']);
export const SOURCES_KEYS = new Set(['sources', 'sourcecount']);
export const RECORDS_KEYS = new Set(['records', 'evidencerecords', 'recordcount']);
export const WEIGHT_KEYS = new Set(['weight', 'impact']);
export const FILED_BY_KEYS = new Set(['agent', 'agentid', 'filedby']);
export const ASSET_KEYS = new Set(['asset', 'assetkind']);
export const ALSO_KEYS = new Set(['also', 'alsogoals', 'bearson', 'relatedgoals']);
export const TITLE_KEYS = new Set(['title']);

/** A claim, the goal it was filed under, and its age are named: the evidence behind a goal. */
export function namesInsights(keys: readonly string[]): boolean {
  const present = new Set(keys.map(normalizeName));
  const has = (set: ReadonlySet<string>) => [...present].some((key) => set.has(key));
  return has(CLAIM_KEYS) && has(GOAL_KEYS) && has(AGE_KEYS);
}
