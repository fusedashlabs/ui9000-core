import { chartRole } from '../../catalog/chart-roles.js';
import type { WorkspaceSpec } from '../../spec/workspace-spec.js';
import { bindFieldMap } from './bind-fields.js';
import { barChartPayload } from './bar-chart.js';
import { chartTypeForComponent } from './chart-type.js';
import { flowSankeyChartPayload } from './flow-sankey-chart.js';
import { histogramChartPayload } from './histogram-chart.js';
import { kpiWidgetPayload } from './kpi-widget.js';
import { hostedChartPayload } from './hosted-chart.js';
import { statusGaugeWidgetPayload } from './status-gauge-widget.js';
import { mapChartPayload } from './map-chart.js';
import { networkGraphPayload } from './network-graph.js';
import { asRowObjects } from './rows.js';

export type ColumnHint = { name: string; role: string };

type PayloadBuilder = (
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
  columns?: readonly ColumnHint[],
) => unknown | null;

/** Components with a chart object. Anything else keeps the raw table rows. */
const PAYLOAD_BY_COMPONENT: Record<string, PayloadBuilder> = {
  'bar-chart': barChartPayload,
  'histogram-chart': histogramChartPayload,
  'map-chart': mapChartPayload,
  'network-graph': networkGraphPayload,
  'flow-sankey-chart': flowSankeyChartPayload,
  'kpi-widget': (chartType, fields, rows, columns) => {
    void chartType;
    return kpiWidgetPayload(fields, rows, columns);
  },
  'status-gauge-widget': (chartType, fields, rows) => {
    void chartType;
    return statusGaugeWidgetPayload(fields, rows);
  },
};

function builderFor(component: string): PayloadBuilder | undefined {
  const known = PAYLOAD_BY_COMPONENT[component];
  if (known) return known;
  if (!chartRole(component)) return undefined;
  return (chartType, fields, rows) => hostedChartPayload(component, chartType, fields, rows);
}

export function workspaceWidgetPayload(
  component: string,
  chartType: string | undefined,
  binds: WorkspaceSpec['binds'],
  payload: unknown,
  columns?: readonly ColumnHint[],
): unknown {
  const rows = asRowObjects(payload);
  if (!rows) return payload;
  const build = builderFor(component);
  if (!build) return payload;
  return build(chartType ?? chartTypeForComponent(component), bindFieldMap(binds), rows, columns);
}
