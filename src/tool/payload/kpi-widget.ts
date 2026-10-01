/**
 * KPI object from mcp-ui generate_kpi_widget.
 * single_value stores the number at aggregations_column (sum_count, avg_score, last_revenue),
 * never under the bare word "sum" or a renamed key.
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
  const value =
    aggregation === 'avg'
      ? numbers.reduce((sum, item) => sum + item, 0) / numbers.length
      : aggregation === 'last'
        ? lastByTime(rows, metric, columns)
        : numbers.reduce((sum, item) => sum + item, 0);
  const key = `${aggregation}_${metric}`;
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
