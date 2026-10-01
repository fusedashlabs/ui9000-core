/**
 * Jev question pack. The options are chart ids from chart-roles, never free text.
 *
 * Step 1 asks which class fits. Step 2 asks which drawing inside that class fits.
 */

import { chartFamiliesFor } from '../catalog/discuss-chart.js';
import { chartRole, type ChartFamily } from '../catalog/chart-roles.js';
import type { DataProfile } from '../spec/data-profile.js';
import { intentFrom } from '../spec/intent.js';

export const JEV_MODEL = 'jev-latest';

export type JevColumn = {
  name: string;
  role: string;
};

export type JevChartState = {
  utterance: string;
  columns: JevColumn[];
  categoryCardinality: number;
  rowCount: number;
  /** The tool's classification. Context for Jev, not a filter on the options. */
  intent: string;
};

export type JevChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};

export type JevNoulQuestion = {
  type: 'noul';
  instructions: string;
};

export type JevChartRequest = {
  state: JevChartState;
  model: typeof JEV_MODEL;
  questions: {
    chart: JevChoiceQuestion;
    /** Present on the class question only, and only when the tool call omitted requestedChart. */
    named_chart?: JevNoulQuestion;
  };
};

const NAMED_CHART: JevNoulQuestion = {
  type: 'noul',
  instructions: 'The utterance names a specific chart drawing, such as line, bar, pie, or map.',
};

/** Step 1. One option per eligible family: its main chart, described by the family question. */
export function classChoiceRequest(input: {
  utterance: string;
  columns: readonly JevColumn[];
  profile: DataProfile;
  intent: string;
  askNamedChart: boolean;
}): JevChartRequest {
  const families = chartFamiliesFor(input.profile, input.columns, intentFrom(input.intent));
  const criteria: Record<string, string> = {};
  for (const family of families) {
    if (!criteria[family.main]) criteria[family.main] = family.question;
  }
  if (Object.keys(criteria).length === 0) {
    throw new Error('No chart family matches this profile, so Jev has no options.');
  }
  return {
    state: jevState(input),
    model: JEV_MODEL,
    questions: {
      chart: {
        type: 'choice',
        instructions:
          'Which of these classes fits the columns and the utterance? Use only these options.',
        criteria,
      },
      ...(input.askNamedChart ? { named_chart: NAMED_CHART } : {}),
    },
  };
}

/** Step 2. Only the drawings of the class Jev already chose. */
export function markChoiceRequest(input: {
  utterance: string;
  columns: readonly JevColumn[];
  profile: DataProfile;
  intent: string;
  family: ChartFamily;
}): JevChartRequest {
  const criteria: Record<string, string> = {};
  criteria[input.family.main] = input.family.question;
  for (const alt of input.family.alternatives) {
    const role = chartRole(alt.id);
    const base = role ? `${role.role} ${role.data}` : input.family.question;
    criteria[alt.id] = `${base} ${alt.when}`;
  }
  return {
    state: jevState(input),
    model: JEV_MODEL,
    questions: {
      chart: {
        type: 'choice',
        instructions:
          'Which of these drawings of the chosen class fits best? Use only these options.',
        criteria,
      },
    },
  };
}

export type JevChoiceAnswer = {
  type: 'choice';
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};

export type JevNoulAnswer = {
  type: 'noul';
  noul: number;
};

export type JevChartResponse = {
  answers?: {
    intent?: JevChoiceAnswer;
    chart?: JevChoiceAnswer;
    named_chart?: JevNoulAnswer;
  };
};

export const JEV_MIN_CONFIDENCE = 0.5;
export const JEV_MIN_LEAD = 0.15;

export type AcceptedReading = {
  /** Offered id Jev named. Null when that id was not one of the options. */
  top: string | null;
  runnerUp: string | null;
  confidence: number;
  /** Top probability minus the runner-up. Zero when probabilities were not sent. */
  lead: number;
  /**
   * Confidence clears the gate, the id was offered, and either there is one
   * option or the lead clears the gate. Missing probabilities do not fail the lead.
   */
  clear: boolean;
  namedChart: boolean;
};

/** Trust only an id we offered, and only when confidence and lead both clear. */
export function acceptReading(
  response: JevChartResponse,
  allowed: readonly string[],
  minConfidence = JEV_MIN_CONFIDENCE,
  minLead = JEV_MIN_LEAD,
): AcceptedReading {
  const chart = response.answers?.chart;
  const allowedSet = new Set(allowed);
  const confidence = typeof chart?.confidence === 'number' ? chart.confidence : 0;
  const choice = chart?.choice ?? '';
  const top = allowedSet.has(choice) ? choice : null;
  const probabilities = chart?.probabilities ?? {};
  const ranked = allowed
    .filter((id) => id !== top)
    .map((id) => ({ id, p: typeof probabilities[id] === 'number' ? probabilities[id] : 0 }))
    .sort((a, b) => b.p - a.p || a.id.localeCompare(b.id));
  const runner = ranked[0];
  const hasProbabilities = allowed.some((id) => typeof probabilities[id] === 'number');
  const topP = top && typeof probabilities[top] === 'number' ? probabilities[top] : confidence;
  const lead = top ? topP - (runner?.p ?? 0) : 0;
  const named = response.answers?.named_chart?.noul;
  const leadOk = !hasProbabilities || allowed.length <= 1 || lead >= minLead;
  return {
    top,
    runnerUp: runner && (runner.p > 0 || !hasProbabilities) ? runner.id : null,
    confidence,
    lead,
    clear: top !== null && confidence >= minConfidence && leadOk,
    namedChart: typeof named === 'number' && named >= 0.5,
  };
}

export function offeredChartIds(request: JevChartRequest): string[] {
  return Object.keys(request.questions.chart.criteria);
}

function jevState(input: {
  utterance: string;
  columns: readonly JevColumn[];
  profile: DataProfile;
  intent: string;
}): JevChartState {
  return {
    utterance: input.utterance.trim(),
    columns: input.columns.map((column) => ({ name: column.name, role: column.role })),
    categoryCardinality: input.profile.categoryCardinality ?? 0,
    rowCount: input.profile.rowCount ?? 0,
    intent: input.intent,
  };
}
