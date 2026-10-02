/**
 * Two Jev calls, then one outcome: draw or miss.
 * A miss leaves the engine draw in place. A clear class does the same when its chart cannot be drawn.
 */

import {
  canDraw,
  chartFamiliesFor,
  chartFitsProfile,
  chartNamedByWords,
  resolveChartName,
} from '../catalog/discuss-chart.js';
import { chartLabel, chartRole, type ChartFamily } from '../catalog/chart-roles.js';
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

export type JevOutcome = JevDraw | { kind: 'miss' } | { kind: 'skip' };

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
      local &&
      canDraw(local, input.profile, input.catalogIds) &&
      chartFitsProfile(local, input.profile)
    ) {
      return {
        kind: 'draw',
        chartId: local,
        by: 'named',
        why:
          reading.clear && family && inFamily(local, family)
            ? `You asked for ${chartLabel(local)}. Jev selected the same class, ${family.question} so this chart stays.`
            : `You asked for ${chartLabel(local)}, so this chart is drawn.`,
      };
    }
  }
  if (!reading.clear || !reading.top) {
    return hesitate(input, families, named, reading.top, reading.runnerUp);
  }

  const family = families.find((item) => item.main === reading.top);
  if (!family) return { kind: 'miss' };
  const runner = families.find((item) => item.main === reading.runnerUp);

  if (named && inFamily(named, family) && canDraw(named, input.profile, input.catalogIds)) {
    return {
      kind: 'draw',
      chartId: named,
      by: 'named',
      why: `You asked for ${chartLabel(named)}. Jev selected the same class, ${family.question} so this chart stays.`,
    };
  }

  const picked = await pickMark(input, columns, family);
  const chartId = picked.id;
  const why = drawWhy(family, runner, chartId, picked.runnerUp, picked.fromMark);

  if (
    named &&
    canDraw(named, input.profile, input.catalogIds) &&
    chartFitsProfile(named, input.profile)
  ) {
    return {
      kind: 'draw',
      chartId: named,
      by: 'named',
      why: `You asked for ${chartLabel(named)}, so this chart is drawn.`,
    };
  }
  if (canDraw(chartId, input.profile, input.catalogIds) && chartFitsProfile(chartId, input.profile)) {
    return { kind: 'draw', chartId, by: 'jev', why };
  }
  return { kind: 'miss' };
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
      why: `You asked for ${chartLabel(named)}. Jev hesitated between ${chartLabel(first.main)} and ${chartLabel(second.main)}, and this chart is one of those classes, so it stays.`,
    };
  }

  const lead = [first, second].find((family) =>
    canDraw(family.main, input.profile, input.catalogIds),
  );
  if (
    named &&
    canDraw(named, input.profile, input.catalogIds) &&
    chartFitsProfile(named, input.profile)
  ) {
    return {
      kind: 'draw',
      chartId: named,
      by: 'named',
      why: `You asked for ${chartLabel(named)}. Jev hesitated between ${chartLabel(first.main)} and ${chartLabel(second.main)}, and this chart is drawn.`,
    };
  }
  if (lead) {
    return {
      kind: 'draw',
      chartId: lead.main,
      by: 'jev',
      why: `Jev hesitated between ${chartLabel(first.main)} and ${chartLabel(second.main)}, and drew ${chartLabel(lead.main)}, because ${because(lead.question)}`,
    };
  }
  return { kind: 'miss' };
}

function drawWhy(
  family: ChartFamily,
  runner: ChartFamily | undefined,
  chartId: string,
  markRunner: string | null,
  fromMark: boolean,
): string {
  const over = runner ? ` over ${chartLabel(runner.main)}` : '';
  const classBit = `Jev selected ${chartLabel(family.main)}${over}, because ${because(family.question)}`;
  if (!fromMark) return classBit;
  const markOver = markRunner ? ` over ${chartLabel(markRunner)}` : '';
  return `${classBit} Inside it, Jev selected ${chartLabel(chartId)}${markOver}, because ${markBecause(family, chartId)}`;
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
