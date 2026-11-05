/**
 * Column names (normalized) that describe a reasoning orchestration: steps
 * linked to the step they came from, a stage or a depth, and an active path.
 *
 * Shared by the family gate in discuss-chart (names only) and the payload
 * builder (names and values), so the two cannot drift apart.
 */

export const STEP_KEYS = new Set([
  'node',
  'nodeid',
  'step',
  'stepid',
  'thought',
  'thoughtid',
  'reasoningstep',
  'candidate',
  'candidateid',
  'id',
]);
export const PARENT_KEYS = new Set([
  'parent',
  'parentid',
  'parentnode',
  'parentstep',
  'prev',
  'previous',
  'previousstep',
  'derivedfrom',
  'refines',
]);
/** Edge tables: each row is a link, and its other columns describe the target. */
export const EDGE_PAIRS: readonly (readonly [string, string])[] = [
  ['source', 'target'],
  ['from', 'to'],
];
export const STAGE_KEYS = new Set(['stage', 'stagename', 'phase', 'reasoningstage', 'pipelinestage']);
export const DEPTH_KEYS = new Set(['depth', 'level', 'layer', 'iteration', 'round']);
export const MODEL_KEYS = new Set(['model', 'modelname', 'llm', 'strategy', 'policy', 'solver']);
export const STATE_KEYS = new Set(['state', 'status', 'outcome', 'result', 'verdict']);
export const SCORE_KEYS = new Set(['score', 'confidence', 'reward', 'probability', 'prob', 'prm', 'prmscore']);
export const PATH_KEYS = new Set([
  'path',
  'pathid',
  'branch',
  'branchid',
  'trajectory',
  'trajectoryid',
  'chain',
  'chainid',
  'candidatepath',
]);
/** Per row: is this step on the active path. */
export const ACTIVE_KEYS = new Set([
  'active',
  'isactive',
  'selected',
  'isselected',
  'chosen',
  'best',
  'onactivepath',
  'inactivepath',
]);
/** One value on every row: the id of the active path. */
export const ACTIVE_PATH_KEYS = new Set(['activepath', 'activepathid', 'selectedpath', 'chosenpath', 'bestpath']);
export const LABEL_KEYS = new Set(['label', 'text', 'summary', 'description', 'content', 'name']);
export const ENTROPY_KEYS = new Set(['entropy', 'stepentropy', 'tokenentropy']);
/** Numeric columns averaged per stage for the top chart. */
export const STAGE_METRIC_KEYS = new Set([
  'accuracy',
  'acc',
  'passrate',
  'f1',
  'compute',
  'tokens',
  'cost',
  'latency',
  'latencyms',
]);
export const TITLE_KEYS = new Set(['title']);

export function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The column names alone describe a reasoning orchestration: steps and the
 * step each came from (or a link pair), a stage or a depth, and a way to name
 * the active path. A plain source,target list has no stage and no active path.
 */
export function namesOrchestration(keys: readonly string[]): boolean {
  const present = new Set(keys.map(normalizeKey));
  const has = (set: ReadonlySet<string>) => [...present].some((key) => set.has(key));
  const linked =
    (has(STEP_KEYS) && has(PARENT_KEYS)) || EDGE_PAIRS.some(([a, b]) => present.has(a) && present.has(b));
  return linked && (has(STAGE_KEYS) || has(DEPTH_KEYS)) && (has(ACTIVE_KEYS) || has(ACTIVE_PATH_KEYS));
}
