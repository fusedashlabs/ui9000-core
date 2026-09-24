import { aggregatePoints } from './rows.js';

/** Above this many categories, labels sit on the Y axis. */
const VERTICAL_CATEGORY_MAX = 8;

type Orientation = 'vertical' | 'horizontal';

/**
 * Bar object the chart element can plot.
 * Single series: category × metric, no groupBy.
 * Grouped: a second category column, never the same field as the axes.
 * Many categories flip to horizontal so the labels stay readable.
 */
export function barChartPayload(
  _chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const category = fields.category;
  const metric = fields.metric;
  if (!category || !metric || category === metric) return null;

  const series = seriesField(fields, category, metric, rows);
  const data = series
    ? rowsByCategoryAndSeries(rows, category, metric, series)
    : singleSeriesRows(rows, category, metric);
  if (!data) return null;

  const orientation = categoryCount(data, category) > VERTICAL_CATEGORY_MAX
    ? 'horizontal'
    : 'vertical';
  const grouped = !!series;
  const xField = orientation === 'horizontal' ? metric : category;
  const yField = orientation === 'horizontal' ? category : metric;

  return {
    chartType: barChartType(orientation, grouped),
    name: 'bar-chart',
    orientation,
    xAxe: [xField],
    yAxe: [yField],
    ...(series ? { groupBy: [series], stacked: false } : {}),
    data,
  };
}

function seriesField(
  fields: Record<string, string>,
  category: string,
  metric: string,
  rows: Record<string, unknown>[],
): string | undefined {
  const candidate = fields.series ?? fields.group ?? fields.groupBy;
  if (!candidate || candidate === category || candidate === metric) return undefined;
  if (!(candidate in rows[0]!)) return undefined;
  const values = new Set<string>();
  for (const row of rows) {
    const value = String(row[candidate] ?? '').trim();
    if (value) values.add(value);
    if (values.size > 1) return candidate;
  }
  return undefined;
}

function singleSeriesRows(
  rows: Record<string, unknown>[],
  category: string,
  metric: string,
): Record<string, unknown>[] | null {
  const points = aggregatePoints(rows, category, metric);
  if (!points) return null;
  return points.map((point) => ({ [category]: point.label, [metric]: point.value }));
}

function rowsByCategoryAndSeries(
  rows: Record<string, unknown>[],
  category: string,
  metric: string,
  series: string,
): Record<string, unknown>[] | null {
  const sums = new Map<string, number>();
  const order: string[] = [];
  for (const row of rows) {
    const cat = String(row[category] ?? '').trim();
    const ser = String(row[series] ?? '').trim();
    const value = Number(row[metric]);
    if (!cat || !ser || !Number.isFinite(value)) continue;
    const key = `${cat}\0${ser}`;
    if (!sums.has(key)) order.push(key);
    sums.set(key, (sums.get(key) ?? 0) + value);
  }
  if (order.length === 0) return null;
  return order.map((key) => {
    const split = key.indexOf('\0');
    return {
      [category]: key.slice(0, split),
      [series]: key.slice(split + 1),
      [metric]: sums.get(key),
    };
  });
}

function categoryCount(rows: Record<string, unknown>[], category: string): number {
  return new Set(rows.map((row) => String(row[category] ?? ''))).size;
}

function barChartType(orientation: Orientation, grouped: boolean): string {
  if (orientation === 'horizontal') {
    return grouped ? 'barHorizontalGrouped' : 'barHorizontal';
  }
  return grouped ? 'barGrouped' : 'barChart';
}
