/**
 * Data first, then the chart the user asked for.
 *
 * The profile describes which families the columns support, and may name a
 * closer chart. That name is a suggestion. A requested chart this workspace
 * can draw is the one that is drawn, including a poor fit. Nothing is
 * generated in its place.
 */

import type { ClassifiedColumn } from '../profiler/roles.js';
import type { DataProfile } from '../spec/data-profile.js';
import { INTENTS, type Intent } from '../spec/intent.js';
import { CHART_FAMILIES, CHART_ROLES, type ChartFamily, type ChartId, chartRole, familiesForChart } from './chart-roles.js';

export type ChartDiscussion = {
  /** Family ids the columns can support, most specific first. */
  dataFamilies: string[];
  /** Resolved widgets id, when the request named a known chart. */
  requestedChart?: string;
  /**
   * Closer chart from the column reading. A description, not a replacement.
   * Absent when the drawn chart is already in a supported family, or when
   * nothing drawable is worth naming.
   */
  suggestion?: string;
  suggestionWhy: string;
  /**
   * The named chart fits the columns and must stay, even when this workspace
   * cannot draw it. Jev must not replace it with another chart.
   */
  keepRequested?: boolean;
  /**
   * The drawn chart is outside the supported families, so chartWhy still
   * names the local suggestion. Jev replaces that sentence with its own.
   */
  poorFit?: boolean;
  /** suggestionWhy is already Jev's offer. Do not append another closer sentence. */
  suggestionFromJev?: boolean;
  /** Set when the user's chart should be rendered now. */
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
  intent: Intent;
  catalogIds: ReadonlySet<string>;
}): ChartDiscussion {
  const counts = columnCounts(input.profile, input.columns);
  const families = eligibleFamilies(input.profile, counts);
  const resolved = resolveChartName(input.requestedChart);
  const judged = resolved ? judgeRequest(resolved, families) : undefined;
  const proposal = pickProposal(families, input.intent, input.profile);
  const drawable = proposal ? firstDrawable(proposal, families, input.profile, input.catalogIds) : undefined;
  const suggestionWhy = proposal ? whyFamily(proposal) : 'These columns do not match a chart category.';
  const inGroup = judged?.kind === 'main' || judged?.kind === 'alternative';
  const askId =
    proposal && canDraw(proposal.main, input.profile, input.catalogIds) ? proposal.main : drawable;
  const suggestion = askId && askId !== resolved ? askId : undefined;

  const base = {
    dataFamilies: families.map((family) => family.id),
    ...(resolved ? { requestedChart: resolved } : {}),
  };

  if (resolved && canDraw(resolved, input.profile, input.catalogIds)) {
    const family = inGroup ? judged?.family : undefined;
    const chartWhy = family
      ? whyInFamily(resolved, family)
      : whyDrawnAnyway(resolved, suggestionWhy);
    return {
      ...base,
      ...(!inGroup && suggestion ? { suggestion } : {}),
      suggestionWhy: !inGroup && suggestion ? suggestionWhy : chartWhy,
      ...(family ? {} : { poorFit: true }),
      drawId: resolved,
      awaitingUser: false,
      message: chartWhy,
      chartWhy,
    };
  }

  if (inGroup && resolved && judged.family) {
    const chartWhy = whyInFamily(resolved, judged.family);
    return {
      ...base,
      suggestionWhy: chartWhy,
      keepRequested: true,
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

  return {
    ...base,
    ...(suggestion ? { suggestion } : {}),
    suggestionWhy,
    awaitingUser: true,
    chartWhy: '',
    message: cannotDrawMessage({
      raw: input.requestedChart,
      resolved,
      suggestion,
      suggestionWhy,
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

/** Stems this short are ordinary English ("area", "line", "bar", "map"). */
const SHORT_CHART_STEM = 4;
const CHART_ARTICLES = new Set(['a', 'an', 'the']);
/** "the area" is a place, not an area chart. "the map" and "the line" are charts. */
const THE_STEM_BLOCK = new Set(['area']);

/**
 * True when the user's words name this chart. A model-invented id does not count.
 * Aliases are whole tokens ("bar chart", "sankey"), not substrings ("bargain").
 * A stem of 4 letters or fewer counts after "a", "an", or "the" ("a bar", "the map").
 * "the area" does not confirm an area chart.
 */
export function utteranceNamesChart(utterance: string, requestedChart: string): boolean {
  const id = resolveChartName(requestedChart);
  if (!id) return false;
  const aliases = new Set<string>();
  for (const [key, value] of LOOSE_NAMES) {
    if (value === id && key.length >= 3) aliases.add(key);
  }
  const raw = normalizeName(requestedChart);
  if (raw.length >= 3) aliases.add(raw);
  if (aliases.size === 0) return false;
  const tokens = utterance
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => normalizeName(token));
  const windows = new Set(tokens);
  for (let i = 0; i < tokens.length - 1; i++) {
    const left = tokens[i];
    const right = tokens[i + 1];
    if (left && right) windows.add(left + right);
  }
  for (const alias of aliases) {
    if (alias.length > SHORT_CHART_STEM) {
      if (windows.has(alias)) return true;
      continue;
    }
    for (let i = 1; i < tokens.length; i++) {
      const prev = tokens[i - 1];
      if (tokens[i] !== alias || !prev || !CHART_ARTICLES.has(prev)) continue;
      if (prev === 'the' && THE_STEM_BLOCK.has(alias)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Keep requestedChart when the utterance is absent, when this is a datasetId
 * follow-up with no new table, or when the words name that chart.
 * On a new table, drop a known chart the words do not name.
 * An unknown name stays, so the existing hold still applies.
 */
export function requestedChartFromUtterance(
  utterance: string | undefined,
  requestedChart: string | undefined,
  options?: { followUp?: boolean },
): string | undefined {
  const named = requestedChart?.trim();
  if (!named) return undefined;
  if (options?.followUp) return named;
  const words = utterance?.trim();
  if (!words) return named;
  if (!resolveChartName(named)) return named;
  return utteranceNamesChart(words, named) ? named : undefined;
}

export function chartWhyFor(componentId: string): string | undefined {
  return chartRole(componentId) ? whyChart(componentId) : undefined;
}

/** Families whose data shape the profile can support. Same gates as discussChart. */
export function chartFamiliesFor(
  profile: DataProfile,
  columns?: readonly { role: string }[],
  intent?: Intent,
): ChartFamily[] {
  const families = eligibleFamilies(profile, columnCounts(profile, columns));
  const preferred = preferenceIds(profile, intent);
  if (!preferred) return families;
  const rank = (id: string) => {
    const index = preferred.indexOf(id);
    return index === -1 ? preferred.length : index;
  };
  return families
    .map((family, index) => ({ family, index }))
    .sort((a, b) => rank(a.family.id) - rank(b.family.id) || a.index - b.index)
    .map((item) => item.family);
}

/**
 * The intent's own families, in preference order.
 * Empty when the intent has a list and none of those families fit the columns.
 */
export function guidedChartFamilies(
  profile: DataProfile,
  columns: readonly { role: string }[] | undefined,
  intent: Intent,
): ChartFamily[] {
  const preferred = preferenceIds(profile, intent);
  if (!preferred) return [];
  const ids = new Set(preferred);
  return chartFamiliesFor(profile, columns, intent).filter((family) => ids.has(family.id));
}

function preferenceIds(profile: DataProfile, intent: Intent | undefined): readonly string[] | undefined {
  const known = intent && (INTENTS as readonly string[]).includes(intent) ? intent : undefined;
  if (!known) return undefined;
  const preferred = preferenceFor(known, profile);
  return preferred.length > 0 ? preferred : undefined;
}

/** True when this intent should refuse a chart outside its families. */
export function intentGuidesCharts(intent: Intent): boolean {
  return INTENT_PREFERENCE[intent].length > 0;
}

/**
 * A drawing has to match the profile, not only sit in the catalog.
 * Line and area need time. Pie needs a small set of categories. A map needs geo.
 */
export function chartFitsProfile(id: string, profile: DataProfile): boolean {
  if (id === 'map-chart') return profile.hasGeo === true && profile.hasMapToken === true;
  if (id === 'pie-chart' || id === 'donut-chart') {
    const card = profile.categoryCardinality ?? 0;
    return card >= 2 && card <= 8;
  }
  if (
    id === 'line-chart' ||
    id === 'area-chart' ||
    id === 'step-line-chart' ||
    id.startsWith('spark')
  ) {
    return profile.hasTemporal === true;
  }
  if (id === 'scatter-plot-chart' || id === 'bubble-chart') {
    return profile.hasNumericMetric === true;
  }
  return true;
}

/** The one chart the words name, or nothing when they name zero or several. */
export function chartNamedByWords(utterance: string): ChartId | undefined {
  let found: ChartId | undefined;
  for (const id of Object.keys(CHART_ROLES) as ChartId[]) {
    if (!utteranceNamesChart(utterance, id)) continue;
    if (found && found !== id) return undefined;
    found = id;
  }
  return found;
}

function preferenceFor(intent: Intent, profile: DataProfile): string[] {
  const preferred = [...INTENT_PREFERENCE[intent]];
  if (intent === 'comparison' && profile.hasTemporal === true && profile.hasNumericMetric === true) {
    const distribution = preferred.indexOf('distribution');
    const ordered = preferred.indexOf('ordered-series');
    if (distribution !== -1 && ordered > distribution) {
      preferred.splice(ordered, 1);
      preferred.splice(distribution, 0, 'ordered-series');
    }
  }
  return preferred;
}

/** Both ids are the main or an alternative of one family the columns support. */
export function sharesEligibleFamily(
  left: string,
  right: string,
  familyIds: readonly string[],
): boolean {
  const eligible = new Set(familyIds);
  const rightIds = new Set(
    familiesForChart(right)
      .map((family) => family.id)
      .filter((id) => eligible.has(id)),
  );
  return familiesForChart(left).some((family) => rightIds.has(family.id));
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
  if (profile.hasCategory && profile.hasNumericMetric && card >= 2 && card <= 8) {
    ids.push('part-to-whole');
  }
  if (profile.hasCategory && profile.hasNumericMetric && card >= 2 && card <= 24) {
    ids.push('contribution');
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

function columnCounts(profile: DataProfile, columns?: readonly { role: string }[]): ColumnCounts {
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

function pickProposal(
  families: readonly ChartFamily[],
  intent: Intent,
  profile: DataProfile,
): ChartFamily | undefined {
  const preferred = preferenceFor(intent, profile);
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

export function canDraw(id: string, profile: DataProfile, catalogIds: ReadonlySet<string>): boolean {
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

function whyDrawnAnyway(id: string, suggestionWhy: string): string {
  const role = chartRole(id);
  return `You asked for ${id} (${role?.role ?? 'this chart'}). Drawing it. ${suggestionWhy} That is a suggestion. This chart stays ${id}.`;
}

function cannotDrawMessage(input: {
  raw: string;
  resolved: string | undefined;
  suggestion: string | undefined;
  suggestionWhy: string;
}): string {
  const asked = input.resolved ? chartRole(input.resolved) : undefined;
  const selected = asked
    ? `You selected ${input.resolved} (${asked.role}).`
    : `You selected "${input.raw.trim()}", which is not a chart I know.`;
  const held = 'This workspace cannot draw it, so nothing was generated in its place.';
  const offer = input.suggestion
    ? `${input.suggestionWhy} A closer chart would be ${input.suggestion}. That is a suggestion only. Call again with it only if the user asks for that chart.`
    : `${input.suggestionWhy} This workspace cannot draw a chart for this table. Do not call again.`;
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
