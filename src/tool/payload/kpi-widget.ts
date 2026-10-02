/**
 * KPI object from mcp-ui generate_kpi_widget.
 * The number sits at aggregations_column (sum_count, avg_score, last_revenue),
 * never under the bare word "sum" or a renamed key.
 *
 * A category with two or more groups is the high and the low, even when a
 * date column is present. Otherwise two periods are a trend: each period is
 * the sum of its rows, and the card is the latest period against the one
 * before. A date-shaped id is not a group. Anything else is one number.
 */
const AVERAGE_TOKENS = new Set(['rate', 'ratio', 'percent', 'pct', 'score', 'price', 'avg', 'average', 'mean']);
const COUNT_TOKENS = new Set(['count', 'incident', 'incidents', 'unit', 'units', 'qty', 'quantity']);

export function kpiWidgetPayload(
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
  columns?: readonly { name: string; role: string }[],
): unknown | null {
  const metric = fields.metric;
  if (!metric || metric === fields.category) return null;
  const numbers: number[] = [];
  for (const row of rows) {
    const n = Number(row[metric]);
    if (Number.isFinite(n)) numbers.push(n);
  }
  if (numbers.length === 0) return null;
  const aggregation = aggregationFor(metric, columns);
  const key = `${aggregation}_${metric}`;
  const grouped = aggregation === 'avg' ? 'avg' : 'sum';
  const extremes = categoryExtremes(rows, metric, columns, grouped);
  if (extremes) {
    const groupKey = `${grouped}_${metric}`;
    return {
      chartType: 'KPI',
      name: metric,
      items: [
        {
          type: 'high/low_overall',
          name: metric,
          column: metric,
          aggregations: grouped,
          groupBy: extremes.category,
          data: [
            {
              high: { [extremes.category]: extremes.high.label, [groupKey]: extremes.high.value },
              low: { [extremes.category]: extremes.low.label, [groupKey]: extremes.low.value },
            },
          ],
        },
      ],
    };
  }
  const series = aggregation === 'last' ? finiteSeries(rows, metric, columns) : [];
  if (series.length >= 2) {
    const current = series[series.length - 1]!.value;
    const previous = series[series.length - 2]!.value;
    return {
      chartType: 'KPI',
      name: metric,
      items: [
        {
          type: 'trend',
          name: metric,
          column: metric,
          aggregations: aggregation,
          showPercentage: true,
          data: [
            {
              [key]: current,
              percentage: changePercent(current, previous),
              subtitle: 'vs previous period',
            },
          ],
        },
      ],
    };
  }
  const value =
    aggregation === 'avg'
      ? numbers.reduce((sum, item) => sum + item, 0) / numbers.length
      : aggregation === 'last'
        ? (series[0]?.value ?? lastByTime(rows, metric, columns))
        : numbers.reduce((sum, item) => sum + item, 0);
  return {
    chartType: 'KPI',
    name: metric,
    items: [
      {
        type: 'single_value',
        name: metric,
        column: metric,
        aggregations: aggregation,
        data: [{ value: { [key]: value } }],
      },
    ],
  };
}

/** Periods earliest first. Each period is the sum of its rows, not the last row. */
function finiteSeries(
  rows: Record<string, unknown>[],
  metric: string,
  columns: readonly { name: string; role: string }[] | undefined,
): { value: number }[] {
  const temporal = columns?.find((column) => column.role === 'temporal')?.name;
  if (!temporal) return [];
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const value = Number(row[metric]);
    if (!Number.isFinite(value)) continue;
    const key = timeKey(row[temporal]);
    if (!key) continue;
    byKey.set(key, (byKey.get(key) ?? 0) + value);
  }
  return [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((entry) => ({ value: entry[1] }));
}

/**
 * Highest and lowest group. The first category that actually groups wins,
 * so a ticket id does not hide Zone 1. A date-shaped id is not a group.
 */
function categoryExtremes(
  rows: Record<string, unknown>[],
  metric: string,
  columns: readonly { name: string; role: string }[] | undefined,
  aggregation: 'sum' | 'avg',
): {
  category: string;
  high: { label: string; value: number };
  low: { label: string; value: number };
} | null {
  const names = columns?.filter((column) => column.role === 'category').map((column) => column.name) ?? [];
  for (const category of names) {
    const extremes = extremesFor(rows, metric, category, aggregation);
    if (extremes) return { category, ...extremes };
  }
  return null;
}

function extremesFor(
  rows: Record<string, unknown>[],
  metric: string,
  category: string,
  aggregation: 'sum' | 'avg',
): { high: { label: string; value: number }; low: { label: string; value: number } } | null {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const raw = row[category];
    if (typeof raw !== 'string' || !isGroupLabel(raw)) continue;
    const value = Number(row[metric]);
    if (!Number.isFinite(value)) continue;
    const label = raw.trim();
    const list = buckets.get(label) ?? [];
    list.push(value);
    buckets.set(label, list);
  }
  const groups = [...buckets.entries()].map(([label, values]) => ({
    label,
    value:
      aggregation === 'avg'
        ? values.reduce((sum, item) => sum + item, 0) / values.length
        : values.reduce((sum, item) => sum + item, 0),
  }));
  if (groups.length < 2) return null;
  let high = groups[0]!;
  let low = groups[0]!;
  for (const group of groups.slice(1)) {
    if (group.value > high.value || (group.value === high.value && group.label < high.label)) {
      high = group;
    }
    if (group.value < low.value || (group.value === low.value && group.label > low.label)) {
      low = group;
    }
  }
  if (high.label === low.label) return null;
  return { high, low };
}

/** A group name. A year-month ticket is an id. "Room 101" and "Q1" are groups. */
function isGroupLabel(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return !/\d{4}-\d/.test(text);
}

function changePercent(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 10000) / 100;
}

/**
 * Average when the metric name has an average token of its own (`score`, not `meaningful`).
 * Last when a classified column is temporal and the metric is not a count.
 * A date-shaped id in another column does not count as time.
 */
function aggregationFor(
  metric: string,
  columns: readonly { name: string; role: string }[] | undefined,
): 'sum' | 'avg' | 'last' {
  const words = metric.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => AVERAGE_TOKENS.has(word))) return 'avg';
  const temporal = columns?.some((column) => column.role === 'temporal') === true;
  if (temporal && !words.some((word) => COUNT_TOKENS.has(word))) return 'last';
  return 'sum';
}

/** The finite metric on the latest temporal value. A tie keeps the later row. */
function lastByTime(
  rows: Record<string, unknown>[],
  metric: string,
  columns: readonly { name: string; role: string }[] | undefined,
): number {
  const temporal = columns?.find((column) => column.role === 'temporal')?.name;
  let best: { value: number; key: string; index: number } | undefined;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const value = Number(row[metric]);
    if (!Number.isFinite(value)) continue;
    const key = temporal ? timeKey(row[temporal]) : '';
    if (!best || key > best.key || (key === best.key && index > best.index)) {
      best = { value, key, index };
    }
  }
  return best!.value;
}

const MONTH_NUMBER: Record<string, string> = {
  january: '01', jan: '01',
  february: '02', feb: '02',
  march: '03', mar: '03',
  april: '04', apr: '04',
  may: '05',
  june: '06', jun: '06',
  july: '07', jul: '07',
  august: '08', aug: '08',
  september: '09', sep: '09', sept: '09',
  october: '10', oct: '10',
  november: '11', nov: '11',
  december: '12', dec: '12',
};

/** Zero-padded YYYY-MM[-DD], or a month name. Other text does not sort as later. */
function timeKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  const match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ](.*))?$/);
  if (match) {
    const day = (match[3] ?? '00').padStart(2, '0');
    return `${match[1]}-${match[2]!.padStart(2, '0')}-${day}T${match[4] ?? ''}`;
  }
  const named = text.match(/^(?:(\d{4})\s+)?([A-Za-z]+)(?:\s+(\d{4}))?$/);
  const month = named ? MONTH_NUMBER[named[2]!.toLowerCase()] : undefined;
  if (!month) return '';
  const year = named?.[1] ?? named?.[3] ?? '0000';
  return `${year}-${month}-00T`;
}
