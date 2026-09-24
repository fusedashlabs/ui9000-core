import { DATA_PROFILE_KEYS, type DataProfile } from '../spec/data-profile.js';
import type { Intent } from '../spec/intent.js';

export type TraceCandidate = {
  id: string;
  score: number;
  reasons: string[];
};

export type TraceRejection = {
  id: string;
  reason: string;
};

/** What the host did with the decision. `held` and `rejected` are previews, not blocks. */
export const TRACE_OUTCOMES = ['rendered', 'held', 'rejected'] as const;

export type TraceOutcome = (typeof TRACE_OUTCOMES)[number];

/**
 * Closed bands. `low` may run with the workspace. `held` is a preview until
 * someone approves it. A spec cannot choose either value.
 */
export const TRACE_RISK_BANDS = ['low', 'held'] as const;

export type TraceRiskBand = (typeof TRACE_RISK_BANDS)[number];

/** One catalog action. The band is filled by the risk table, never by the spec. */
export type TraceRisk = {
  action: string;
  band: TraceRiskBand;
};

/**
 * Preview of a held action. Null when nothing is held.
 * This is not an execution record and must not carry dataset rows.
 */
export type TraceProposal = {
  /** Stable id `proposal:<action>`. Audit records use this, not a fresh uuid. */
  id: string;
  action: string;
  preview: string;
};

/**
 * JSON-serializable decision record. Never includes dataset rows.
 * Stage 3 fields stay required. Stage 4 adds `risk`, `proposals`, `proposal`, and `outcome`.
 */
export type Trace = {
  objective: Intent;
  profile: DataProfile;
  candidates: TraceCandidate[];
  rejections: TraceRejection[];
  actions: string[];
  tieBreak: string;
  risk: TraceRisk[];
  /** Every held catalog action, in catalog order. Empty when nothing is held. */
  proposals: TraceProposal[];
  /** First held action. Same object as `proposals[0]`, null when the list is empty. */
  proposal: TraceProposal | null;
  outcome: TraceOutcome;
};

/**
 * Blank governance fields, before `governTrace` classifies catalog actions.
 * An empty `risk` is "not classified yet", not "every action is low".
 * `outcome: rendered` is only this blank default. A held action leaves `governTrace` as `held`.
 */
export function stage4TraceDefaults(): Pick<Trace, 'risk' | 'proposals' | 'proposal' | 'outcome'> {
  return {
    risk: [],
    proposals: [],
    proposal: null,
    outcome: 'rendered',
  };
}

export function closedProfile(profile: DataProfile): DataProfile {
  const next: DataProfile = {};
  for (const key of DATA_PROFILE_KEYS) {
    if (profile[key] !== undefined) {
      (next as Record<string, unknown>)[key] = profile[key];
    }
  }
  return next;
}

const ROW_KEYS = new Set(['rows', 'data']);

export function assertTraceHasNoRows(trace: Trace): void {
  walkForRows(trace);
}

function walkForRows(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) walkForRows(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (ROW_KEYS.has(key) && Array.isArray(child)) {
      throw new Error('trace must not contain rows');
    }
    walkForRows(child);
  }
}
