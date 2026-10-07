/**
 * Band utilization object for `<ui9000-band-utilization-chart>`.
 *
 * The widget reads a WidgetItem, not a custom series list. Long rows use
 * `yAxe` as the entity, `xAxe` as the share, and `groupBy` as the segment.
 * Wide rows use `xAxe` as the entity and one `yAxe` column per segment.
 *
 * Call this chart only when that breakdown is repeated for at least two
 * entities and each entity sums to 100. One category of slices stays a pie.
 * Values that do not sum to a whole stay a bar.
 */

import { familiesForChart } from '../../catalog/chart-roles.js';

const WHOLE = 100;
const EPS = 0.5;

const UNIT_KEYS = new Set(['unit', 'measureunit', 'measureunitsymbol', 'uom']);
const TITLE_KEYS = new Set(['title']);

type Row = Record<string, unknown>;

type LongAxes = { kind: 'long'; entity: string; segment: string; share: string };
type WideAxes = { kind: 'wide'; entity: string; shares: string[] };

export function bandUtilizationFits(payload: unknown): boolean {
  const rows = asRows(payload);
  if (!rows) return false;
  return longAxes(rows) !== null || wideAxes(rows) !== null;
}

/** Pie for one whole. Band when the same shares repeat once per entity. */
export function partToWholeChart(payload: unknown): 'pie-chart' | 'band-utilization-chart' {
  return bandUtilizationFits(payload) ? 'band-utilization-chart' : 'pie-chart';
}

export function isPartToWholeChart(id: string): boolean {
  return familiesForChart(id).some((family) => family.id === 'part-to-whole');
}

export function bandUtilizationPayload(
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const axes =
    fittingAxes(fields, rows) ?? longAxes(rows) ?? wideAxes(rows) ?? incompleteAxes(fields, rows);
  if (!axes) return null;
  return axes.kind === 'long' ? longPayload(axes, rows) : widePayload(axes, rows);
}

/**
 * Bound columns, but only when that pair already sums to a whole.
 * A first metric that does not (`weight` beside `share`) must not win
 * over the column `longAxes` finds.
 */
function fittingAxes(fields: Record<string, string>, rows: Row[]): LongAxes | null {
  const bound = boundAxes(fields, rows);
  if (!bound) return null;
  if (sumsToWhole(rows, bound.label, bound.series, bound.share)) {
    return { kind: 'long', entity: bound.label, segment: bound.series, share: bound.share };
  }
  if (sumsToWhole(rows, bound.series, bound.label, bound.share)) {
    return { kind: 'long', entity: bound.series, segment: bound.label, share: bound.share };
  }
  return null;
}

/** Named chart on a short row: keep the bound columns even when they do not sum to 100. */
function incompleteAxes(fields: Record<string, string>, rows: Row[]): LongAxes | null {
  const bound = boundAxes(fields, rows);
  if (!bound) return null;
  return { kind: 'long', entity: bound.label, segment: bound.series, share: bound.share };
}

function boundAxes(
  fields: Record<string, string>,
  rows: Row[],
): { label: string; series: string; share: string } | null {
  const label = present(rows, fields.label ?? fields.entity);
  const series = present(rows, fields.series ?? fields.segment);
  const share = present(rows, fields.y ?? fields.share ?? fields.metric);
  if (!label || !series || !share || label === series || label === share || series === share) {
    return null;
  }
  return { label, series, share };
}

function longAxes(rows: Row[]): LongAxes | null {
  const { text, numeric } = splitKeys(rows);
  if (text.length < 2 || numeric.length < 1) return null;
  for (const share of numeric) {
    for (const entity of text) {
      for (const segment of text) {
        if (entity === segment) continue;
        if (sumsToWhole(rows, entity, segment, share)) {
          return { kind: 'long', entity, segment, share };
        }
      }
    }
  }
  return null;
}

function wideAxes(rows: Row[]): WideAxes | null {
  const { text, numeric } = splitKeys(rows);
  if (text.length !== 1 || numeric.length < 2 || rows.length < 2) return null;
  const entity = text[0]!;
  const seen = new Set<string>();
  for (const row of rows) {
    const label = textOf(row[entity]);
    if (!label || seen.has(label)) return null;
    seen.add(label);
    let sum = 0;
    for (const key of numeric) {
      const value = finite(row[key]);
      if (value === undefined) return null;
      sum += value;
    }
    if (Math.abs(sum - WHOLE) > EPS) return null;
  }
  return { kind: 'wide', entity, shares: numeric };
}

function sumsToWhole(rows: Row[], entity: string, segment: string, share: string): boolean {
  const groups = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const label = textOf(row[entity]);
    const part = textOf(row[segment]);
    const value = finite(row[share]);
    if (!label || !part || value === undefined) continue;
    const parts = groups.get(label) ?? new Map<string, number>();
    parts.set(part, (parts.get(part) ?? 0) + value);
    groups.set(label, parts);
  }
  if (groups.size < 2) return false;
  let expected: string[] | undefined;
  for (const parts of groups.values()) {
    if (parts.size < 2) return false;
    const names = [...parts.keys()].sort();
    if (!expected) expected = names;
    else if (names.join('\0') !== expected.join('\0')) return false;
    let sum = 0;
    for (const value of parts.values()) sum += value;
    if (Math.abs(sum - WHOLE) > EPS) return false;
  }
  return true;
}

function longPayload(axes: LongAxes, rows: Row[]): unknown | null {
  const data: Row[] = [];
  const entities: string[] = [];
  const segments: string[] = [];
  for (const row of rows) {
    const label = textOf(row[axes.entity]);
    const part = textOf(row[axes.segment]);
    const value = finite(row[axes.share]);
    if (!label || !part || value === undefined) continue;
    if (!entities.includes(label)) entities.push(label);
    if (!segments.includes(part)) segments.push(part);
    data.push({ [axes.entity]: label, [axes.segment]: part, [axes.share]: value });
  }
  if (data.length === 0 || segments.length === 0) return null;
  return widgetPayload({
    name: titleOf(rows),
    yAxe: [axes.entity],
    xAxe: [axes.share],
    groupBy: [axes.segment],
    uniqueValues: { [axes.entity]: entities, [axes.segment]: segments },
    shareFields: [axes.share],
    unit: unitOf(rows),
    data,
  });
}

function widePayload(axes: WideAxes, rows: Row[]): unknown | null {
  const data: Row[] = [];
  const entities: string[] = [];
  for (const row of rows) {
    const label = textOf(row[axes.entity]);
    if (!label) continue;
    const next: Row = { [axes.entity]: label };
    let kept = false;
    for (const key of axes.shares) {
      const value = finite(row[key]);
      if (value === undefined) continue;
      next[key] = value;
      kept = true;
    }
    if (!kept) continue;
    if (!entities.includes(label)) entities.push(label);
    data.push(next);
  }
  if (data.length === 0) return null;
  return widgetPayload({
    name: titleOf(rows),
    xAxe: [axes.entity],
    yAxe: axes.shares,
    uniqueValues: { [axes.entity]: entities },
    shareFields: axes.shares,
    unit: unitOf(rows),
    data,
  });
}

function widgetPayload(input: {
  name: string | undefined;
  xAxe: string[];
  yAxe: string[];
  groupBy?: string[];
  uniqueValues: Record<string, string[]>;
  shareFields: string[];
  unit: string | undefined;
  data: Row[];
}): Record<string, unknown> {
  const detail = percentDetail(input.unit);
  const axisDetails: Record<string, ReturnType<typeof percentDetail>> = {};
  for (const field of input.shareFields) axisDetails[field] = detail;
  return {
    chartType: 'bandUtilizationChart',
    name: input.name ?? 'band-utilization-chart',
    xAxe: input.xAxe,
    yAxe: input.yAxe,
    ...(input.groupBy ? { groupBy: input.groupBy } : {}),
    uniqueValues: input.uniqueValues,
    axisDetails,
    data: input.data,
  };
}

function percentDetail(unit: string | undefined): {
  label: string;
  type: 'number';
  subtype?: 'percentage';
  measure_unit?: string;
  measure_unit_type?: 'percentage';
  measure_unit_symbol?: string;
} {
  if (unit && unit !== '%') {
    return { label: unit, type: 'number', measure_unit: unit };
  }
  return {
    label: 'Percent',
    type: 'number',
    subtype: 'percentage',
    measure_unit_type: 'percentage',
    measure_unit_symbol: '%',
  };
}

function splitKeys(rows: Row[]): { text: string[]; numeric: string[] } {
  const keys = Object.keys(rows[0] ?? {}).filter((key) => !isUnitKey(key) && !isTitleKey(key));
  const numeric = keys.filter((key) => isNumericColumn(rows, key));
  const text = keys.filter((key) => !numeric.includes(key));
  return { text, numeric };
}

function isNumericColumn(rows: Row[], key: string): boolean {
  let seen = 0;
  let numeric = 0;
  for (const row of rows) {
    const raw = row[key];
    if (raw == null || String(raw).trim() === '') continue;
    seen += 1;
    if (finite(raw) !== undefined) numeric += 1;
  }
  return seen > 0 && numeric / seen >= 0.9;
}

function asRows(payload: unknown): Row[] | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const rows = payload.filter(isRow);
  return rows.length > 0 ? rows : null;
}

function isRow(value: unknown): value is Row {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function present(rows: Row[], field: string | undefined): string | undefined {
  if (!field || rows.length === 0 || !(field in rows[0]!)) return undefined;
  return field;
}

function finite(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function textOf(value: unknown): string {
  return String(value ?? '').trim();
}

function unitOf(rows: Row[]): string | undefined {
  return constantText(rows, isUnitKey);
}

function titleOf(rows: Row[]): string | undefined {
  return constantText(rows, isTitleKey);
}

function constantText(rows: Row[], match: (key: string) => boolean): string | undefined {
  for (const key of Object.keys(rows[0] ?? {})) {
    if (!match(key)) continue;
    const values = new Set(rows.map((row) => textOf(row[key])).filter(Boolean));
    if (values.size === 1) return [...values][0];
  }
  return undefined;
}

function isUnitKey(key: string): boolean {
  return UNIT_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ''));
}

function isTitleKey(key: string): boolean {
  return TITLE_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ''));
}
