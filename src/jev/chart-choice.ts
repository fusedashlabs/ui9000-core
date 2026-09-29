/**
 * Jev question pack. The options are chart ids from chart-roles, never free text.
 *
 * show_workspace asks this on each draw. Jev's chart is the one rendered when
 * the user named none, and only a suggestion when they named one.
 */

import { chartFamiliesFor } from '../catalog/discuss-chart.js';
import { chartRole, type ChartFamily } from '../catalog/chart-roles.js';
import { INTENTS, type Intent } from '../spec/intent.js';
import type { DataProfile } from '../spec/data-profile.js';

export const JEV_MODEL = 'jev-latest';

const INTENT_CRITERIA: Record<Intent, string> = {
  spatial: 'Place a metric on a map.',
  comparison: 'Compare groups, a series, a distribution, or two measures.',
  summary: 'State one or a few headline numbers.',
  form: 'Collect or confirm a value.',
  evidence: 'Show a claim, a table, or an event timeline.',
  graph: 'Show what is connected to what, or how much flows from source to target.',
};

export type JevColumn = {
  name: string;
  role: string;
};

export type JevChartState = {
  utterance: string;
  columns: JevColumn[];
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
    intent: JevChoiceQuestion;
    chart: JevChoiceQuestion;
    named_chart: JevNoulQuestion;
  };
};

export function chartChoiceRequest(input: {
  utterance: string;
  columns: readonly JevColumn[];
  profile: DataProfile;
}): JevChartRequest {
  const families = chartFamiliesFor(input.profile, input.columns);
  const criteria = chartCriteria(families);
  if (Object.keys(criteria).length === 0) {
    throw new Error('No chart family matches this profile, so Jev has no options.');
  }

  return {
    state: {
      utterance: input.utterance.trim(),
      columns: input.columns.map((column) => ({
        name: column.name,
        role: column.role,
      })),
    },
    model: JEV_MODEL,
    questions: {
      intent: {
        type: 'choice',
        instructions: 'Which intent matches the utterance?',
        criteria: intentCriteria(),
      },
      chart: {
        type: 'choice',
        instructions:
          'Which of these charts best fits the columns and the utterance? Use only these options. Choose the best reading of the data, even when the utterance names a different drawing.',
        criteria,
      },
      named_chart: {
        type: 'noul',
        instructions: 'The utterance names a specific chart drawing, such as line, bar, pie, or map.',
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

export type AcceptedChart = {
  chart: string | null;
  intent: string | null;
  confidence: number;
  namedChart: boolean;
  probabilities: Record<string, number>;
};

/** Trust only an id we offered, and only when confidence clears the gate. */
export function acceptChartChoice(
  response: JevChartResponse,
  allowed: readonly string[],
  minConfidence = 0.5,
): AcceptedChart {
  const chart = response.answers?.chart;
  const intent = response.answers?.intent;
  const allowedSet = new Set(allowed);
  const intentSet = new Set<string>(INTENTS);
  const confidence = typeof chart?.confidence === 'number' ? chart.confidence : 0;
  const choice = chart?.choice ?? '';
  const intentChoice = intent?.choice ?? '';
  const named = response.answers?.named_chart?.noul;
  return {
    chart: allowedSet.has(choice) && confidence >= minConfidence ? choice : null,
    intent: intentSet.has(intentChoice) ? intentChoice : null,
    confidence,
    namedChart: typeof named === 'number' && named >= 0.5,
    probabilities: chart?.probabilities ?? {},
  };
}

export function offeredChartIds(request: JevChartRequest): string[] {
  return Object.keys(request.questions.chart.criteria);
}

function intentCriteria(): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const intent of INTENTS) criteria[intent] = INTENT_CRITERIA[intent];
  return criteria;
}

function chartCriteria(families: readonly ChartFamily[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const family of families) {
    note(criteria, family.main, family);
    for (const alt of family.alternatives) note(criteria, alt.id, family);
  }
  return criteria;
}

function note(criteria: Record<string, string>, id: string, family: ChartFamily): void {
  const role = chartRole(id);
  const base = role ? `${role.role} ${role.data}` : family.question;
  const alt = family.alternatives.find((item) => item.id === id);
  const sentence = alt ? `${base} ${alt.when}` : base;
  const prev = criteria[id];
  if (!prev) {
    criteria[id] = sentence;
    return;
  }
  if (alt && !prev.includes(alt.when)) criteria[id] = `${prev} ${alt.when}`;
}
