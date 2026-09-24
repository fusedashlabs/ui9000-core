import type { TraceRisk, TraceRiskBand } from '../trace/trace.js';

/**
 * Closed risk table. Bands come from the action name in catalog metadata.
 * A workspace spec cannot lower a band: this module never reads `spec.risk`
 * or `spec.allowedActions`.
 *
 * low:  hover, resize, pan, zoom
 * held: submit, approve, reject, filter, drag
 * anything else is held — an unlisted action is not low
 */

export const RISK_EFFECTS = ['observe', 'commit', 'narrow', 'move', 'unlisted'] as const;
export const RISK_REVERSIBILITIES = ['reversible', 'irreversible'] as const;
export const RISK_SCOPES = ['view', 'record', 'query', 'layout', 'unknown'] as const;

export type RiskEffect = (typeof RISK_EFFECTS)[number];
export type RiskReversibility = (typeof RISK_REVERSIBILITIES)[number];
export type RiskScope = (typeof RISK_SCOPES)[number];

export type RiskAssessment = {
  effect: RiskEffect;
  reversibility: RiskReversibility;
  scope: RiskScope;
  band: TraceRiskBand;
};

export type ClassifiedAction = TraceRisk & RiskAssessment;

const VIEW: RiskAssessment = {
  effect: 'observe',
  reversibility: 'reversible',
  scope: 'view',
  band: 'low',
};

const COMMIT: RiskAssessment = {
  effect: 'commit',
  reversibility: 'irreversible',
  scope: 'record',
  band: 'held',
};

const NARROW: RiskAssessment = {
  effect: 'narrow',
  reversibility: 'reversible',
  scope: 'query',
  band: 'held',
};

const MOVE: RiskAssessment = {
  effect: 'move',
  reversibility: 'reversible',
  scope: 'layout',
  band: 'held',
};

/** Fail closed. An action the table does not name cannot be low. */
const UNLISTED: RiskAssessment = {
  effect: 'unlisted',
  reversibility: 'irreversible',
  scope: 'unknown',
  band: 'held',
};

export const RISK_TABLE: Readonly<Record<string, RiskAssessment>> = {
  hover: VIEW,
  resize: VIEW,
  pan: VIEW,
  zoom: VIEW,
  submit: COMMIT,
  approve: COMMIT,
  reject: COMMIT,
  filter: NARROW,
  drag: MOVE,
};

export function classifyAction(action: string): RiskAssessment {
  return { ...(RISK_TABLE[action] ?? UNLISTED) };
}

/** `allowedActions` from the catalog entry. Do not pass the spec's list. */
export function classifyActions(catalogActions: readonly string[]): ClassifiedAction[] {
  return catalogActions.map((action) => ({ action, ...classifyAction(action) }));
}

/**
 * Catalog actions win. `spec` is accepted so a caller can pass the hostile
 * document and we can prove it is ignored — including `spec.risk` and
 * `spec.allowedActions`.
 */
export function classifyCatalogActions(
  catalogActions: readonly string[] | undefined,
  spec?: unknown,
): ClassifiedAction[] {
  void spec;
  return classifyActions(catalogActions ?? []);
}
