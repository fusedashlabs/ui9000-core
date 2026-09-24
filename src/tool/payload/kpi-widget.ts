/**
 * KPI object from mcp-ui generate_kpi_widget.
 * single_value stores the number at aggregations_column (sum_<metric>),
 * never under the bare word "sum" or a renamed key.
 */
export function kpiWidgetPayload(
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const metric = fields.metric;
  if (!metric || metric === fields.category) return null;
  let total = 0;
  let saw = false;
  for (const row of rows) {
    const n = Number(row[metric]);
    if (!Number.isFinite(n)) continue;
    total += n;
    saw = true;
  }
  if (!saw) return null;
  const key = `sum_${metric}`;
  return {
    chartType: 'KPI',
    name: metric,
    items: [
      {
        type: 'single_value',
        name: metric,
        column: metric,
        aggregations: 'sum',
        data: [{ value: { [key]: total } }],
      },
    ],
  };
}
