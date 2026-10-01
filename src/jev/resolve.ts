/**
 * Two Jev calls, then one outcome: draw, hold for the user, or miss.
 * A miss leaves the engine draw in place. A clear class never falls through to it.
 */

import {
  canDraw,
  chartFamiliesFor,
  chartFitsProfile,
  chartNamedByWords,
  resolveChartName,
} from '../catalog/discuss-chart.js';
import { chartRole, type ChartFamily } from '../catalog/chart-roles.js';
import type { ClassifiedColumn } from '../profiler/roles.js';
import type { DataProfile } from '../spec/data-profile.js';
import { intentFrom } from '../spec/intent.js';
import {
  acceptReading,
  classChoiceRequest,
  markChoiceRequest,
  offeredChartIds,
  type JevChartRequest,
  type JevChartResponse,
  type JevColumn,
} from './chart-choice.js';

export type JevAsk = (request: JevChartRequest) => Promise<JevChartResponse>;

export type JevDraw = {
  kind: 'draw';
  chartId: string;
  why: string;
  by: 'named' | 'jev';
};

export type JevHold = {
  kind: 'hold';
  message: string;
  suggestionWhy: string;
  suggestion?: string;
  dataFamilies: string[];
  requestedChart?: string;
};

export type JevOutcome = JevDraw | JevHold | { kind: 'miss' } | { kind: 'skip' };

export async function resolveJev(input: {
  ask?: JevAsk;
  utterance: string;
  intent: string;
  requestedChart?: string;
  profile: DataProfile;
  classified?: readonly ClassifiedColumn[];
  catalogIds: ReadonlySet<string>;
}): Promise<JevOutcome> {
  if (!input.ask) return { kind: 'skip' };
  const families = chartFamiliesFor(input.profile, input.classified, intentFrom(input.intent));
  const dataFamilies = families.map((family) => family.id);
  if (families.length === 0) return { kind: 'miss' };

  const columns: JevColumn[] = (input.classified ?? []).map((column) => ({
    name: column.column.name,
    role: column.role,
  }));
  const askedForChart = Boolean(input.requestedChart?.trim());
  const named = askedForChart ? resolveChartName(input.requestedChart ?? '') : undefined;
  let classResponse: JevChartResponse;
  try {
    classResponse = await input.ask(
      classChoiceRequest({
        utterance: input.utterance,
        columns,
        profile: input.profile,
        intent: input.intent,
        askNamedChart: !input.requestedChart,
      }),
    );
  } catch {
    return { kind: 'miss' };
  }

  const offered = families.map((family) => family.main);
  const reading = acceptReading(classResponse, offered);
  if (!input.requestedChart && reading.namedChart) {
    const local = chartNamedByWords(input.utterance);
    const family = families.find((item) => item.main === reading.top);
    if (
      reading.clear &&
      family &&
      local &&
      inFamily(local, family) &&
      canDraw(local, input.profile, input.catalogIds) &&
      chartFitsProfile(local, input.profile)
    ) {
      return {
        kind: 'draw',
        chartId: local,
        by: 'named',
        why: `You asked for ${local}. Jev selected the same class, ${family.question} so this chart stays.`,
      };
    }
    return {
      kind: 'hold',
      dataFamilies,
      message:
        'The utterance names a chart. Pass that chart as requestedChart and call again with the same datasetId. Do not draw another chart in its place.',
      suggestionWhy: 'The utterance names a chart. This call did not draw a substitute.',
    };
  }
  if (!reading.clear || !reading.top) {
    return hesitate(input, families, dataFamilies, named, reading.top, reading.runnerUp);
  }

  const family = families.find((item) => item.main === reading.top);
  if (!family) return { kind: 'miss' };
  const runner = families.find((item) => item.main === reading.runnerUp);

  if (named && inFamily(named, family) && canDraw(named, input.profile, input.catalogIds)) {
    return {
      kind: 'draw',
      chartId: named,
      by: 'named',
      why: `You asked for ${named}. Jev selected the same class, ${family.question} so this chart stays.`,
    };
  }

  const picked = await pickMark(input, columns, family);
  const chartId = picked.id;
  const why = drawWhy(family, runner, chartId, picked.runnerUp, picked.fromMark);

  if (!askedForChart) {
    if (!canDraw(chartId, input.profile, input.catalogIds)) {
      const role = chartRole(chartId);
      return {
        kind: 'hold',
        dataFamilies,
        message: `${why} ${role?.data ?? ''} This workspace cannot draw it. Nothing was generated.`.replace(/\s+/g, ' ').trim(),
        suggestionWhy: why,
      };
    }
    return { kind: 'draw', chartId, by: 'jev', why };
  }

  const asked = named ? chartRole(named) : undefined;
  const askedFamily = named ? families.find((item) => inFamily(named, item)) : undefined;
  const recommend = canDraw(chartId, input.profile, input.catalogIds) ? chartId : undefined;
  const recommendation = recommend
    ? `Jev would draw ${recommend}, because ${markBecause(family, recommend)} Nothing was generated. Say which of the two you want.`
    : `${why} This workspace cannot draw it. Nothing was generated.`;
  const known = !asked || !named
    ? `You selected "${input.requestedChart?.trim()}", which is not a chart I know.`
    : askedFamily && canDraw(named, input.profile, input.catalogIds)
      ? `You asked for ${named}. ${asked.role} That reading is: ${askedFamily.question}`
      : `You asked for ${named}. ${asked.data}`;
  const message = `${known} ${recommendation}`.replace(/\s+/g, ' ').trim();
  return {
    kind: 'hold',
    dataFamilies,
    ...(named ? { requestedChart: named } : {}),
    ...(recommend ? { suggestion: recommend } : {}),
    suggestionWhy: recommend ? `Jev would draw ${recommend}, because ${markBecause(family, recommend)}` : message,
    message,
  };
}

async function pickMark(
  input: {
    ask?: JevAsk;
    utterance: string;
    intent: string;
    profile: DataProfile;
    catalogIds: ReadonlySet<string>;
  },
  columns: readonly JevColumn[],
  family: ChartFamily,
): Promise<{ id: string; runnerUp: string | null; fromMark: boolean }> {
  if (family.alternatives.length === 0 || !input.ask) {
    return { id: family.main, runnerUp: null, fromMark: false };
  }
  const request = markChoiceRequest({
    utterance: input.utterance,
    columns,
    profile: input.profile,
    intent: input.intent,
    family,
  });
  try {
    const response = await input.ask(request);
    const reading = acceptReading(response, offeredChartIds(request));
    if (
      reading.clear &&
      reading.top &&
      canDraw(reading.top, input.profile, input.catalogIds) &&
      chartFitsProfile(reading.top, input.profile)
    ) {
      return { id: reading.top, runnerUp: reading.runnerUp, fromMark: reading.top !== family.main };
    }
  } catch {
    // A clear class stays. The mark falls back to its main.
  }
  return { id: family.main, runnerUp: null, fromMark: false };
}

function hesitate(
  input: {
    requestedChart?: string;
    profile: DataProfile;
    catalogIds: ReadonlySet<string>;
  },
  families: readonly ChartFamily[],
  dataFamilies: string[],
  named: string | undefined,
  top: string | null,
  runnerUp: string | null,
): JevOutcome {
  const first = families.find((family) => family.main === top);
  const second = families.find((family) => family.main === runnerUp);
  if (!first || !second) return { kind: 'miss' };

  if (named && canDraw(named, input.profile, input.catalogIds) && (inFamily(named, first) || inFamily(named, second))) {
    return {
      kind: 'draw',
      chartId: named,
      by: 'named',
      why: `You asked for ${named}. Jev hesitated between ${first.main} and ${second.main}, and this chart is one of those classes, so it stays.`,
    };
  }

  const both = `Jev hesitated between ${first.main} and ${second.main}. ${first.question} ${second.question}`;
  if (!input.requestedChart?.trim()) {
    return {
      kind: 'hold',
      dataFamilies,
      message: `${both} Nothing was generated. Say which you want.`,
      suggestionWhy: both,
    };
  }

  const asked = named ? chartRole(named) : undefined;
  const unfit = asked
    ? `You asked for ${named}. ${asked.data}`
    : `You selected "${input.requestedChart?.trim()}", which is not a chart I know.`;
  const message = `${unfit} ${both} Nothing was generated. Say which you want.`.replace(/\s+/g, ' ').trim();
  return {
    kind: 'hold',
    dataFamilies,
    ...(named ? { requestedChart: named } : {}),
    message,
    suggestionWhy: both,
  };
}

function drawWhy(
  family: ChartFamily,
  runner: ChartFamily | undefined,
  chartId: string,
  markRunner: string | null,
  fromMark: boolean,
): string {
  const over = runner ? ` over ${runner.main}` : '';
  const classBit = `Jev selected ${family.main}${over}, because ${because(family.question)}`;
  if (!fromMark) {
    const role = chartRole(chartId);
    return role ? `${classBit} ${role.role}` : classBit;
  }
  const markOver = markRunner ? ` over ${markRunner}` : '';
  return `${classBit} Inside it, Jev selected ${chartId}${markOver}, because ${markBecause(family, chartId)}`;
}

function markBecause(family: ChartFamily, chartId: string): string {
  const alt = family.alternatives.find((item) => item.id === chartId);
  if (alt) return because(alt.when);
  return because(chartRole(chartId)?.role ?? family.question);
}

function because(sentence: string): string {
  const trimmed = sentence.trim().replace(/[.\s]+$/, '');
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function inFamily(id: string, family: ChartFamily): boolean {
  return family.main === id || family.alternatives.some((alt) => alt.id === id);
}
