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

/** JSON-serializable decision record. Never includes dataset rows. */
export type Trace = {
  objective: Intent;
  profile: DataProfile;
  candidates: TraceCandidate[];
  rejections: TraceRejection[];
  actions: string[];
  tieBreak: string;
};

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
