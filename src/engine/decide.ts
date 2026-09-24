import { DATA_PROFILE_KEYS } from '../spec/data-profile.js';
import type { CatalogEntry, CatalogEvalCase, CatalogRule } from '../spec/engine-catalog.js';
import { SPEC_ACTION_SET } from '../spec/workspace-spec.js';
import { closedProfile, stage4TraceDefaults, type Trace } from '../trace/trace.js';
import type { DecideInput, EngineCandidate, EngineDecision, EngineRejection } from './types.js';
import { evalWhen } from './when.js';

const INTENT_MISMATCH = 'Component intents do not include this objective.';
const NO_ELIGIBILITY = 'No eligibility rule matched the profile.';
const BAD_WHEN = 'Catalog when-clause could not be evaluated.';
const MISSING_ID = 'Catalog entry is missing an id.';

export function decide(input: DecideInput): EngineDecision {
  const { intent, catalog } = input;
  const profile = closedProfile(input.profile);
  const eligible: EngineCandidate[] = [];
  const rejected: EngineRejection[] = [];

  const entries = Array.isArray(catalog) ? catalog : [];
  for (const [index, entry] of entries.entries()) {
    if (typeof entry?.id !== 'string' || !entry.id.trim()) {
      rejected.push({ id: `missing-id:${index}`, reason: MISSING_ID });
      continue;
    }
    const result = scoreEntry(entry, intent, profile);
    if (result.kind === 'eligible') {
      eligible.push({ id: entry.id, score: result.score, reasons: result.reasons });
    } else {
      rejected.push({ id: entry.id, reason: result.reason });
    }
  }

  eligible.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const winner = eligible[0] ?? null;
  const runnerUp = eligible[1];
  let tieBreak = 'no eligible candidate';
  if (winner && runnerUp && winner.score === runnerUp.score) {
    tieBreak = `tied at ${winner.score}; picked ${winner.id} before ${runnerUp.id} by id`;
  } else if (winner) {
    tieBreak = `highest score ${winner.score} (${winner.id})`;
  }

  const winnerEntry = winner ? entries.find((entry) => entry.id === winner.id) : undefined;
  const actions = closedActions(winnerEntry);

  const trace: Trace = {
    objective: intent,
    profile,
    candidates: eligible.map((item) => ({ ...item })),
    rejections: rejected.map((item) => ({ ...item })),
    actions,
    tieBreak,
    ...stage4TraceDefaults(),
  };

  return { winner: winner?.id ?? null, eligible, rejected, trace };
}

function scoreEntry(
  entry: CatalogEntry,
  intent: DecideInput['intent'],
  profile: DecideInput['profile'],
): { kind: 'eligible'; score: number; reasons: string[] } | { kind: 'rejected'; reason: string } {
  const intents = entry.intents ?? [];
  if (intents.length === 0 || !intents.includes(intent)) {
    return { kind: 'rejected', reason: INTENT_MISMATCH };
  }

  for (const rule of entry.disqualify ?? []) {
    const matched = matchRule(rule, profile);
    if (matched === 'bad-when') return { kind: 'rejected', reason: BAD_WHEN };
    if (matched) return { kind: 'rejected', reason: sentence(rule.reason) };
  }

  const eligibility = entry.eligibility ?? [];
  const matchedReasons: string[] = [];
  for (const rule of eligibility) {
    const matched = matchRule(rule, profile);
    if (matched === 'bad-when') return { kind: 'rejected', reason: BAD_WHEN };
    if (matched) matchedReasons.push(sentence(rule.reason));
  }

  if (matchedReasons.length === 0) {
    return { kind: 'rejected', reason: NO_ELIGIBILITY };
  }

  let score = 10 + matchedReasons.length * 2;
  for (const evalCase of entry.evalCases ?? []) {
    if (!evalCaseApplies(evalCase, intent, profile)) continue;
    score += 3;
    if (evalCase.reasonIncludes) {
      matchedReasons.push(`evalCase ${evalCase.id ?? 'eligible'}: ${evalCase.reasonIncludes}`);
    }
  }

  return { kind: 'eligible', score, reasons: matchedReasons };
}

function evalCaseApplies(
  evalCase: CatalogEvalCase,
  intent: DecideInput['intent'],
  profile: DecideInput['profile'],
): boolean {
  if (evalCase.intent !== intent) return false;
  if (evalCase.expect !== 'eligible') return false;
  if (!evalCase.profile) return false;
  return profileWitnessMatches(profile, evalCase.profile);
}

/** Witness keys must be present and equal on the input profile. Empty witness never matches. */
function profileWitnessMatches(
  actual: DecideInput['profile'],
  rawWitness: NonNullable<CatalogEvalCase['profile']>,
): boolean {
  const witness = closedProfile(rawWitness);
  let sawKey = false;
  for (const key of DATA_PROFILE_KEYS) {
    if (witness[key] === undefined) continue;
    sawKey = true;
    if (actual[key] !== witness[key]) return false;
  }
  return sawKey;
}

function matchRule(rule: CatalogRule, profile: DecideInput['profile']): boolean | 'bad-when' {
  if (!rule.when?.trim()) return 'bad-when';
  try {
    return evalWhen(rule.when, profile);
  } catch {
    return 'bad-when';
  }
}

function sentence(reason: string | undefined): string {
  const text = reason?.trim() ?? '';
  return text || 'Disqualified by a catalog rule.';
}

function closedActions(entry: CatalogEntry | undefined): string[] {
  if (!entry?.allowedActions) return [];
  return entry.allowedActions.filter((action) => SPEC_ACTION_SET.has(action));
}
