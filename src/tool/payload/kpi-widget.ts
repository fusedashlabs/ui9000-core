export function kpiWidgetPayload(
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const metricField = fields.metric;
  if (!metricField) return null;
  let total = 0;
  let saw = false;
  for (const row of rows) {
    const n = Number(row[metricField]);
    if (!Number.isFinite(n)) continue;
    total += n;
    saw = true;
  }
  if (!saw) return null;
  return {
    chartType: 'KPI',
    type: 'single_value',
    name: metricField,
    data: [{ value: total }],
  };
}
