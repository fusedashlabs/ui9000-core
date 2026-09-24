import { aggregatePoints } from './rows.js';

export function barChartPayload(
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const points = aggregatePoints(rows, fields.category, fields.metric);
  if (!points) return null;
  return { chartType, name: 'bar-chart', data: points };
}
