import { numericColumn } from './rows.js';

/**
 * Histogram object from mcp-ui generate_histogram_chart.
 * yAxe is always empty. xAxe is the one binned column.
 * groupBy stays empty: a histogram of one variable is not a grouped chart,
 * and groupBy must not repeat xAxe.
 * data is one root whose histogramResults use _id as an object, never a string.
 */
export function histogramChartPayload(
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const field = fields.distribution ?? fields.metric;
  if (!field || field === fields.groupBy || field === fields.series) return null;
  const values = numericColumn(rows, field);
  if (!values) return null;

  const bins = histogramBins(values);
  if (bins.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);

  return {
    chartType: chartType || 'histogramChart',
    name: 'histogram-chart',
    xAxe: [field],
    yAxe: [],
    groupBy: [],
    uniqueValues: { [field]: bins.map((bin) => bin.label) },
    data: [
      {
        min,
        max,
        histogramResults: bins.map((bin, index) => ({
          _id: { [field]: bin.label },
          count: bin.count,
          bucketIndex: index,
          group: field,
        })),
      },
    ],
  };
}

function histogramBins(values: number[]): Array<{ label: string; count: number }> {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: formatBin(min), count: values.length }];
  const binCount = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(values.length))));
  const width = (max - min) / binCount;
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of values) {
    let index = Math.floor((value - min) / width);
    if (index >= binCount) index = binCount - 1;
    counts[index] += 1;
  }
  return counts.flatMap((count, index) => {
    if (count === 0) return [];
    const start = min + index * width;
    const end = index === binCount - 1 ? max : min + (index + 1) * width;
    return [{ label: `${formatBin(start)}–${formatBin(end)}`, count }];
  });
}

function formatBin(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
