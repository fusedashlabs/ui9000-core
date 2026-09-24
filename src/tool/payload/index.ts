import type { WorkspaceSpec } from '../../spec/workspace-spec.js';
import { bindFieldMap } from './bind-fields.js';
import { barChartPayload } from './bar-chart.js';
import { chartTypeForComponent } from './chart-type.js';
import { histogramChartPayload } from './histogram-chart.js';
import { kpiWidgetPayload } from './kpi-widget.js';
import { mapChartPayload } from './map-chart.js';
import { asRowObjects } from './rows.js';

type PayloadBuilder = (
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
) => unknown | null;

/** Components with a chart object. Anything else keeps the raw table rows. */
const PAYLOAD_BY_COMPONENT: Record<string, PayloadBuilder> = {
  'bar-chart': barChartPayload,
  'histogram-chart': histogramChartPayload,
  'map-chart': mapChartPayload,
  'kpi-widget': (chartType, fields, rows) => {
    void chartType;
    return kpiWidgetPayload(fields, rows);
  },
};

export function workspaceWidgetPayload(
  component: string,
  chartType: string | undefined,
  binds: WorkspaceSpec['binds'],
  payload: unknown,
): unknown {
  const rows = asRowObjects(payload);
  if (!rows) return payload;
  const build = PAYLOAD_BY_COMPONENT[component];
  if (!build) return payload;
  const built = build(chartType ?? chartTypeForComponent(component), bindFieldMap(binds), rows);
  return built ?? payload;
}
