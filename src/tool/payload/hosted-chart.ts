/**
 * FuseDash widget for a chart that is not one of the five engine builders.
 * The iframe dispatches on `chartType`. Rows stay out of the model context;
 * this object is what the data-link stores.
 */

import type { CatalogDataRole } from '../../spec/engine-catalog.js';
import { aggregatePoints } from './rows.js';

const TIME_X = new Set([
  'line-chart',
  'area-chart',
  'step-line-chart',
  'spark-line-chart',
  'spark-area-chart',
  'scatter-sparkline-chart',
]);

const LABEL_X = new Set([
  'lollipop',
  'radial-bar-chart',
  'polar-area-chart',
  'pie-chart',
  'donut-chart',
  'treemap-chart',
  'waterfall-chart',
  'area-grouped-bar-chart',
  'radar-chart',
  'violin-chart',
  'box-plot-chart',
]);

const POINTS = new Set(['scatter-plot-chart', 'bubble-chart']);
const GRID = new Set(['matrix-chart', 'punchcard-chart']);
const FLOW = new Set(['sankey-chart']);
const MODEL = new Set([
  'partial-dependence-chart',
  'bias-variance-tradeoff-chart',
  'gini-impurity-entropy-chart',
]);

const RAW = new Set([
  ...POINTS,
  ...MODEL,
  'scatter-sparkline-chart',
  'violin-chart',
  'area-grouped-bar-chart',
  'radar-chart',
  'parallel-coordinates-chart',
]);

export function dataRolesForChart(id: string): CatalogDataRole[] {
  if (id === 'status-gauge-widget') return [];
  if (POINTS.has(id) || MODEL.has(id)) {
    return [
      { id: 'mx', required: true },
      { id: 'my', required: true },
      { id: 'series', required: false },
    ];
  }
  if (FLOW.has(id)) {
    return [
      { id: 'source', required: true },
      { id: 'target', required: true },
      { id: 'y', required: true },
    ];
  }
  if (GRID.has(id)) {
    return [
      { id: 'label', required: true },
      { id: 'series', required: true },
      { id: 'y', required: true },
    ];
  }
  if (id === 'parallel-coordinates-chart') {
    return [
      { id: 'y', required: true },
      { id: 'label', required: false },
    ];
  }
  if (TIME_X.has(id)) {
    return [
      { id: 'x', required: true },
      { id: 'y', required: true },
      { id: 'series', required: false },
    ];
  }
  if (LABEL_X.has(id)) {
    return [
      { id: 'label', required: true },
      { id: 'y', required: true },
      { id: 'series', required: false },
    ];
  }
  return [];
}

export function hostedChartPayload(
  id: string,
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  if (rows.length === 0) return null;
  const type = resolveChartType(id, chartType, fields, rows);
  if (id === 'box-plot-chart') return boxPayload(type, fields, rows);
  if (id === 'parallel-coordinates-chart') return parallelPayload(type, fields, rows);
  if (FLOW.has(id)) return flowPayload(type, fields, rows);
  if (GRID.has(id)) return gridPayload(type, fields, rows);
  if (POINTS.has(id) || MODEL.has(id)) return pointPayload(type, fields, rows);
  return seriesPayload(id, type, fields, rows);
}

function seriesPayload(
  id: string,
  chartType: string,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const x = present(rows, fields.x ?? fields.label) ?? inferAxis(rows, 'label');
  const y = present(rows, fields.y ?? fields.metric) ?? inferAxis(rows, 'number');
  if (!x || !y || x === y) return null;
  const series = present(rows, fields.series);
  const data = RAW.has(id) ? rows : summed(rows, x, y, series);
  if (!data) return null;
  return {
    chartType,
    name: id,
    xAxe: [x],
    yAxe: [y],
    ...(series ? { groupBy: [series] } : {}),
    data,
  };
}

function pointPayload(
  chartType: string,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const x = present(rows, fields.mx) ?? inferAxis(rows, 'number');
  const y = present(rows, fields.my) ?? inferAxis(rows, 'number', x);
  if (!x || !y || x === y) return null;
  const series = present(rows, fields.series);
  return {
    chartType,
    name: chartType,
    xAxe: [x],
    yAxe: [y],
    ...(series ? { groupBy: [series] } : {}),
    data: rows,
  };
}

function gridPayload(
  chartType: string,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const x = present(rows, fields.label) ?? inferAxis(rows, 'label');
  const yKey = present(rows, fields.series) ?? inferAxis(rows, 'label', x);
  const value = present(rows, fields.y) ?? inferAxis(rows, 'number');
  if (!x || !yKey || !value) return null;
  return {
    chartType,
    name: chartType,
    xAxe: [x],
    yAxe: [value],
    groupBy: [yKey],
    data: rows,
  };
}

function flowPayload(
  chartType: string,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const source = present(rows, fields.source) ?? inferAxis(rows, 'label');
  const target = present(rows, fields.target) ?? inferAxis(rows, 'label', source);
  const value = present(rows, fields.y) ?? inferAxis(rows, 'number');
  if (!source || !target || !value) return null;
  return {
    chartType,
    name: chartType,
    xAxe: [source],
    yAxe: [value],
    groupBy: [target],
    data: summed(rows, source, value, target) ?? rows,
  };
}

function boxPayload(
  chartType: string,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const x = present(rows, fields.label) ?? inferAxis(rows, 'label');
  const y = present(rows, fields.y) ?? inferAxis(rows, 'number');
  if (!x || !y) return null;
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const label = String(row[x] ?? '').trim();
    const value = Number(row[y]);
    if (!label || !Number.isFinite(value)) continue;
    const list = groups.get(label) ?? [];
    list.push(value);
    groups.set(label, list);
  }
  if (groups.size === 0) return null;
  const data = [...groups.entries()].map(([label, values]) => {
    const stats = fiveNumber(values);
    return { _id: { [x]: label }, ...stats };
  });
  return { chartType, name: 'box-plot-chart', xAxe: [x], yAxe: [y], data };
}

function parallelPayload(
  chartType: string,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const label = present(rows, fields.label);
  const axes = numericKeys(rows).filter((key) => key !== label);
  if (axes.length === 0) return null;
  return {
    chartType,
    name: 'parallel-coordinates-chart',
    ...(label ? { xAxe: [label] } : {}),
    yAxe: [present(rows, fields.y) ?? axes[0]],
    uniqueValues: { axes },
    data: rows,
  };
}

function resolveChartType(
  id: string,
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): string {
  const series = present(rows, fields.series);
  const grouped = !!series && distinct(rows, series) > 1;
  if (!grouped) return chartType || id;
  if (id === 'line-chart') return 'lineGroupedChart';
  if (id === 'area-chart') return 'areaStackedChart';
  if (id === 'lollipop') return 'lollipopGroupedChart';
  if (id === 'radar-chart') return 'radarGroupedChart';
  return chartType || id;
}

function summed(
  rows: Record<string, unknown>[],
  x: string,
  y: string,
  series: string | undefined,
): Record<string, unknown>[] | null {
  if (!series) {
    const points = aggregatePoints(rows, x, y);
    if (!points) return null;
    return points.map((point) => ({ [x]: point.label, [y]: point.value }));
  }
  const sums = new Map<string, number>();
  const order: string[] = [];
  for (const row of rows) {
    const cat = String(row[x] ?? '').trim();
    const ser = String(row[series] ?? '').trim();
    const value = Number(row[y]);
    if (!cat || !ser || !Number.isFinite(value)) continue;
    const key = `${cat}\0${ser}`;
    if (!sums.has(key)) order.push(key);
    sums.set(key, (sums.get(key) ?? 0) + value);
  }
  if (order.length === 0) return null;
  return order.map((key) => {
    const split = key.indexOf('\0');
    return {
      [x]: key.slice(0, split),
      [series]: key.slice(split + 1),
      [y]: sums.get(key),
    };
  });
}

function fiveNumber(values: number[]): Record<string, number> {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  return {
    min,
    q1,
    median,
    q3,
    max,
    smallestNonOutlier: q1,
    biggestNonOutlier: q3,
  };
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  if (lo === hi) return a;
  return a * (hi - index) + b * (index - lo);
}

function present(rows: Record<string, unknown>[], field: string | undefined): string | undefined {
  if (!field || !(field in rows[0]!)) return undefined;
  return field;
}

function inferAxis(
  rows: Record<string, unknown>[],
  kind: 'label' | 'number',
  skip?: string,
): string | undefined {
  for (const key of Object.keys(rows[0]!)) {
    if (key === skip) continue;
    const numeric = rows.some((row) => Number.isFinite(Number(row[key])) && row[key] !== '');
    if (kind === 'number' && numeric) return key;
    if (kind === 'label' && !numeric) return key;
  }
  return undefined;
}

function numericKeys(rows: Record<string, unknown>[]): string[] {
  return Object.keys(rows[0]!).filter((key) =>
    rows.some((row) => Number.isFinite(Number(row[key])) && String(row[key] ?? '') !== ''),
  );
}

function distinct(rows: Record<string, unknown>[], field: string): number {
  return new Set(rows.map((row) => String(row[field] ?? '').trim()).filter(Boolean)).size;
}
