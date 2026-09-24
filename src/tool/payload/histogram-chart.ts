import { numericColumn } from './rows.js';

export function histogramChartPayload(
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const metricField = fields.distribution ?? fields.metric;
  const values = numericColumn(rows, metricField);
  if (!values) return null;
  return { chartType, name: 'histogram-chart', data: histogramBins(values) };
}

function histogramBins(values: number[]): Array<{ label: string; value: number }> {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: formatBin(min), value: values.length }];
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
    return [{ label: `${formatBin(start)}–${formatBin(end)}`, value: count }];
  });
}

function formatBin(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
