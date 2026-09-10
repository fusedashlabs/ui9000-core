import type { DataProfile } from '../spec/data-profile.js';
import type { EngineCatalog } from '../spec/engine-catalog.js';
import type { Intent } from '../spec/intent.js';
import type { Trace, TraceCandidate, TraceRejection } from '../trace/trace.js';

export type EngineCandidate = TraceCandidate;
export type EngineRejection = TraceRejection;

export type EngineDecision = {
  winner: string | null;
  eligible: EngineCandidate[];
  rejected: EngineRejection[];
  trace: Trace;
};

export type DecideInput = {
  intent: Intent;
  profile: DataProfile;
  catalog: EngineCatalog;
};
