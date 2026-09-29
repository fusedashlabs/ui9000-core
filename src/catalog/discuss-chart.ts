/**
 * Data first, then the chart the user asked for.
 *
 * The profile decides which families the columns can support. A requested
 * chart that sits in one of those families stays — a line in the comparison
 * group is not replaced with the group's main. A chart outside the group
 * waits: the tool explains the fit and the proposal, and does not pick for
 * the user.
 */

import type { ClassifiedColumn } from '../profiler/roles.js';
import type { DataProfile } from '../spec/data-profile.js';
import type { Intent } from '../spec/intent.js';
import { CHART_FAMILIES, CHART_ROLES, type ChartFamily, type ChartId, chartRole } from './chart-roles.js';

export type ChartDiscussion = {
  /** Family ids the columns can support, most specific first. */
  dataFamilies: string[];
  /** Resolved widgets id, when the request named a known chart. */
  requestedChart?: string;
  /**
   * Chart the user can accept on the next call. Absent when nothing drawable
   * is on offer — the model must stop, not retry.
   */
  proposedChart?: string;
  proposedWhy: string;
  /** Set only when the user's chart should be rendered now. */
  drawId?: string;
  awaitingUser: boolean;
  /** Sentence the model must show the user. */
  message: string;
  /** Why the drawn chart fits. Empty when nothing is drawn. */
  chartWhy: string;
};

const INTENT_PREFERENCE: Record<Intent, readonly string[]> = {
  spatial: ['spatial'],
  comparison: [
    'category-magnitude',
    'distribution',
    'two-measures',
    'two-way-magnitude',
    'ordered-series',
    'many-metrics',
    'flow',
  ],
  summary: ['headline'],
  form: [],
  evidence: [],
  graph: ['graph', 'flow'],
};

const LOOSE_NAMES = buildLooseNames();

export function discussChart(input: {
  profile: DataProfile;
  columns?: readonly ClassifiedColumn[];
  requestedChart: string;
  confirm: boolean;
  intent: Intent;
  catalogIds: ReadonlySet<string>;
}): ChartDiscussion {
  const counts = columnCounts(input.profile, input.columns);
  const families = eligibleFamilies(input.profile, counts);
  const resolved = resolveChartName(input.requestedChart);
  const judged = resolved ? judgeRequest(resolved, families) : undefined;
  const proposal = pickProposal(families, input.intent);
  const drawable = proposal ? firstDrawable(proposal, families, input.profile, input.catalogIds) : undefined;
  const proposedWhy = proposal ? whyFamily(proposal) : 'These columns do not match a chart category.';
  const inGroup = judged?.kind === 'main' || judged?.kind === 'alternative';

  const base = {
    dataFamilies: families.map((family) => family.id),
    ...(resolved ? { requestedChart: resolved } : {}),
  };

  if (inGroup && resolved && judged.family) {
    const chartWhy = whyInFamily(resolved, judged.family);
    if (canDraw(resolved, input.profile, input.catalogIds)) {
      return {
        ...base,
        proposedChart: resolved,
        proposedWhy: chartWhy,
        drawId: resolved,
        awaitingUser: false,
        message: chartWhy,
        chartWhy,
      };
    }
    return {
      ...base,
      proposedWhy: chartWhy,
      awaitingUser: true,
      chartWhy: '',
      message: [
        `You selected ${resolved} (${chartRole(resolved)?.role ?? 'this chart'}).`,
        `It fits this data: ${judged.family.question} It stays ${resolved}.`,
        'This workspace cannot draw it yet.',
        'I am not switching it to another chart. Do not call again.',
      ].join(' '),
    };
  }

  const askId =
    proposal && canDraw(proposal.main, input.profile, input.catalogIds) ? proposal.main : drawable;

  return {
    ...base,
    ...(askId ? { proposedChart: askId } : {}),
    proposedWhy,
    awaitingUser: true,
    chartWhy: '',
    message: awaitingMessage({
      raw: input.requestedChart,
      resolved,
      proposedChart: askId,
      ideal: proposal?.main,
      proposedWhy,
      confirm: input.confirm,
    }),
  };
}

/** Component id, chartType key, or a short name such as "pie" / "bar chart". */
export function resolveChartName(name: string): ChartId | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  if (trimmed in CHART_ROLES) return trimmed as ChartId;
  const hit = LOOSE_NAMES.get(normalizeName(trimmed));
  return hit && hit in CHART_ROLES ? (hit as ChartId) : undefined;
}

export function chartWhyFor(componentId: string): string | undefined {
  return chartRole(componentId) ? whyChart(componentId) : undefined;
}

function eligibleFamilies(
  profile: DataProfile,
  counts: ColumnCounts,
): ChartFamily[] {
  const card = profile.categoryCardinality ?? 0;
  const ids: string[] = [];
  if (profile.hasLinks && profile.hasNumericMetric) ids.push('flow');
  if (profile.hasNodes && profile.hasLinks) ids.push('graph');
  if (profile.hasGeo) ids.push('spatial');
  if (profile.hasTemporal && profile.hasNumericMetric) ids.push('ordered-series');
  if (counts.categories >= 2 && counts.metrics >= 1) ids.push('two-way-magnitude');
  if (counts.metrics >= 3 && profile.hasCategory) ids.push('many-metrics');
  if (counts.metrics >= 2) ids.push('two-measures');
  if (profile.hasCategory && profile.hasNumericMetric && card > 0 && card <= 40) {
    ids.push('category-magnitude');
  }
  if (profile.hasNumericMetric && !profile.hasCategory && (profile.rowCount ?? 0) >= 8) {
    ids.push('distribution');
  }
  if (
    profile.hasNumericMetric &&
    card <= 12 &&
    (profile.rowCount ?? 0) > 0 &&
    (profile.rowCount ?? 0) <= 12
  ) {
    ids.push('headline');
  }
  return CHART_FAMILIES.filter((family) => ids.includes(family.id));
}

type ColumnCounts = { metrics: number; categories: number };

function columnCounts(profile: DataProfile, columns?: readonly ClassifiedColumn[]): ColumnCounts {
  if (!columns?.length) {
    return {
      metrics: profile.hasNumericMetric ? 1 : 0,
      categories: profile.hasCategory ? 1 : 0,
    };
  }
  return {
    metrics: columns.filter((column) => column.role === 'metric').length,
    categories: columns.filter((column) => column.role === 'category').length,
  };
}

function pickProposal(families: readonly ChartFamily[], intent: Intent): ChartFamily | undefined {
  const preferred = INTENT_PREFERENCE[intent];
  for (const id of preferred) {
    const hit = families.find((family) => family.id === id);
    if (hit) return hit;
  }
  return families[0];
}

function judgeRequest(
  chartId: string,
  families: readonly ChartFamily[],
): { kind: 'main' | 'alternative' | 'unfit'; family?: ChartFamily } {
  for (const family of families) {
    if (family.main === chartId) return { kind: 'main', family };
  }
  for (const family of families) {
    if (family.alternatives.some((alt) => alt.id === chartId)) {
      return { kind: 'alternative', family };
    }
  }
  return { kind: 'unfit' };
}

function canDraw(id: string, profile: DataProfile, catalogIds: ReadonlySet<string>): boolean {
  if (!catalogIds.has(id)) return false;
  if (id === 'map-chart' && profile.hasMapToken !== true) return false;
  return true;
}

function firstDrawable(
  proposal: ChartFamily,
  families: readonly ChartFamily[],
  profile: DataProfile,
  catalogIds: ReadonlySet<string>,
): string | undefined {
  if (canDraw(proposal.main, profile, catalogIds)) return proposal.main;
  for (const family of families) {
    if (canDraw(family.main, profile, catalogIds)) return family.main;
  }
  return undefined;
}

function whyFamily(family: ChartFamily): string {
  const role = chartRole(family.main);
  return `${family.main}: ${role?.role ?? family.question} The columns answer "${family.question}" (${family.data}).`;
}

function whyInFamily(id: string, family: ChartFamily): string {
  const role = chartRole(id);
  const kept = family.main === id ? `${id} is the chart for this group.` : `${id} is in this group, so it stays.`;
  return `${kept} ${role?.role ?? family.question} The columns answer "${family.question}" (${family.data}).`;
}

function whyChart(id: string): string {
  const role = chartRole(id);
  const family = CHART_FAMILIES.find((item) => item.main === id);
  if (!role) return id;
  if (!family) return `${id}: ${role.role}`;
  return `${id}: ${role.role} The columns answer "${family.question}" (${family.data}).`;
}

function awaitingMessage(input: {
  raw: string;
  resolved: string | undefined;
  proposedChart: string | undefined;
  ideal: string | undefined;
  proposedWhy: string;
  confirm: boolean;
}): string {
  const asked = input.resolved ? chartRole(input.resolved) : undefined;
  const selected = asked
    ? `You selected ${input.resolved} (${asked.role}).`
    : `You selected "${input.raw.trim()}", which is not a chart I know.`;

  const held = input.confirm ? 'You confirmed it, and it still does not fit.' : 'It does not fit this data well.';
  const offer =
    input.proposedChart && input.ideal && input.proposedChart !== input.ideal
      ? `${input.proposedWhy} This workspace can draw ${input.proposedChart}. Do you want ${input.proposedChart}?`
      : input.proposedChart
        ? `${input.proposedWhy} I am not choosing it for you. Do you want ${input.proposedChart}?`
        : `${input.proposedWhy} This workspace cannot draw a chart for this table. Do not call again.`;
  return [selected, held, offer].join(' ');
}

function buildLooseNames(): Map<string, string> {
  const loose = new Map<string, string>();
  const remember = (key: string, id: string) => {
    if (!key) return;
    const prev = loose.get(key);
    if (prev === undefined) loose.set(key, id);
    else if (prev !== id) loose.set(key, '');
  };
  for (const role of Object.values(CHART_ROLES)) {
    remember(normalizeName(role.id), role.id);
    remember(normalizeName(role.id.replace(/-chart$/, '')), role.id);
    for (const key of role.chartTypeKeys) remember(normalizeName(key), role.id);
  }
  return loose;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
