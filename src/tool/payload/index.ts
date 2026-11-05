import { chartRole } from '../../catalog/chart-roles.js';
import type { WorkspaceSpec } from '../../spec/workspace-spec.js';
import { bindFieldMap } from './bind-fields.js';
import { bandUtilizationPayload } from './band-utilization.js';
import { barChartPayload } from './bar-chart.js';
import { chartTypeForComponent } from './chart-type.js';
import { flowSankeyChartPayload } from './flow-sankey-chart.js';
import { histogramChartPayload } from './histogram-chart.js';
import { kpiWidgetPayload } from './kpi-widget.js';
import { hostedChartPayload } from './hosted-chart.js';
import { lossIndicatorPayload } from './loss-indicator.js';
import { statusGaugeWidgetPayload } from './status-gauge-widget.js';
import { powerPathCardPayload } from './power-path-card.js';
import { componentAssetCardPayload } from './component-asset-card.js';
import { incidentsReviewCardPayload } from './incidents-review-card.js';
import { assetHealthOverviewPayload } from './asset-health-overview.js';
import { goalBurstPayload } from './goal-burst.js';
import { mapChartPayload } from './map-chart.js';
import { networkGraphPayload } from './network-graph.js';
import { goalsPerimeterPayload } from './goals-perimeter.js';
import { goalsDependencyGraphPayload } from './goals-dependency-graph.js';
import { bipartiteGraphPayload } from './bipartite-graph.js';
import { goalsInsightsPayload } from './goals-insights.js';
import { reasoningOrchestrationPayload } from './reasoning-orchestration-graph.js';
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
  'band-utilization-chart': (chartType, fields, rows) => {
    void chartType;
    return bandUtilizationPayload(fields, rows);
  },
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
  'loss-indicator': (chartType, fields, rows) => {
    void chartType;
    return lossIndicatorPayload(fields, rows);
  },
  'power-path-card': (chartType, fields, rows) => {
    void chartType;
    return powerPathCardPayload(fields, rows);
  },
  'component-asset-card': (chartType, fields, rows) => {
    void chartType;
    return componentAssetCardPayload(fields, rows);
  },
  'incidents-review-card': (chartType, fields, rows) => {
    void chartType;
    return incidentsReviewCardPayload(fields, rows);
  },
  'asset-health-overview': (chartType, fields, rows) => {
    void chartType;
    return assetHealthOverviewPayload(fields, rows);
  },
  'goal-burst': (chartType, fields, rows) => {
    void chartType;
    return goalBurstPayload(fields, rows);
  },
  'goals-perimeter': (chartType, fields, rows) => {
    void chartType;
    return goalsPerimeterPayload(fields, rows);
  },
  'goals-dependency-graph': (chartType, fields, rows) => {
    void chartType;
    return goalsDependencyGraphPayload(fields, rows);
  },
  'bipartite-graph': (chartType, fields, rows) => {
    void chartType;
    return bipartiteGraphPayload(fields, rows);
  },
  'goals-insights': (chartType, fields, rows) => {
    void chartType;
    return goalsInsightsPayload(fields, rows);
  },
  'reasoning-orchestration-graph': (chartType, fields, rows) => {
    void chartType;
    return reasoningOrchestrationPayload(fields, rows);
  },
};

/**
 * The fields the hosted viewer (mcp-ui `fuseWidgetLooksPlottable`) looks for
 * before it unwraps a stored chart object for the widget. A chart object with
 * none of them reaches the widget still wrapped, and the widget draws nothing.
 */
const VIEWER_UNWRAP_FIELDS = [
  'data',
  'layers',
  'items',
  'kpis',
  'histogramResults',
  'boxes',
  'cells',
  'series',
  'points',
  'nodes',
  'links',
] as const;

/**
 * Lets the viewer unwrap a chart object built around other fields (goals,
 * agents, categories, counts) with an empty `cells`, which none of those
 * widgets read. Drop it once the viewer unwraps any object with a chartType.
 */
function unwrappableByViewer(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const chart = payload as Record<string, unknown>;
  if (typeof chart.chartType !== 'string') return payload;
  if (VIEWER_UNWRAP_FIELDS.some((field) => Array.isArray(chart[field]))) return payload;
  return { ...chart, cells: [] };
}

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
  return unwrappableByViewer(
    build(chartType ?? chartTypeForComponent(component), bindFieldMap(binds), rows, columns),
  );
}
