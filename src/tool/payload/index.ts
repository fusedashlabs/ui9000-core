import { chartRole } from '../../catalog/chart-roles.js';
import type { WorkspaceSpec } from '../../spec/workspace-spec.js';
import {
  hasEndpointTitleBinds,
  labelFromFieldMap,
  titleCategoryField,
  titleMetricField,
} from '../shape-spec.js';
import { bindFieldMap } from './bind-fields.js';
import { bandUtilizationPayload } from './band-utilization.js';
import { barChartPayload } from './bar-chart.js';
import { chartTypeForComponent } from './chart-type.js';
import { histogramChartPayload } from './histogram-chart.js';
import { kpiWidgetPayload } from './kpi-widget.js';
import { hostedChartPayload } from './hosted-chart.js';
import { lossIndicatorPayload } from './loss-indicator.js';
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
  'band-utilization-chart': (chartType, fields, rows) => {
    void chartType;
    return bandUtilizationPayload(fields, rows);
  },
  'bar-chart': barChartPayload,
  'histogram-chart': histogramChartPayload,
  'map-chart': mapChartPayload,
  'network-graph': networkGraphPayload,
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
};

function builderFor(component: string): PayloadBuilder | undefined {
  const known = PAYLOAD_BY_COMPONENT[component];
  if (known) return known;
  if (!chartRole(component)) return undefined;
  return (chartType, fields, rows) => hostedChartPayload(component, chartType, fields, rows);
}

/** True when `name` is a component/chartType slug, not a human title. */
export function isSlugChartName(name: string, component: string): boolean {
  if (!name || name === component) return true;
  if (/\s/.test(name)) return false;
  // kebab ids: treemap-chart, network-graph, lollipop
  if (/^[a-z]+(-[a-z0-9]+)+$/.test(name) || name === 'lollipop') return true;
  // FuseDash camelCase types: barChart, lineGroupedChart
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(name)) return true;
  return false;
}

function firstAxis(value: unknown): string | undefined {
  if (!Array.isArray(value) || typeof value[0] !== 'string') return undefined;
  const name = value[0].trim();
  return name || undefined;
}

/**
 * Title from the axes the builder actually plotted.
 * Prefer this over binds when a builder remaps the metric (e.g. band weight → share).
 */
function titleFromPlottedAxes(
  built: Record<string, unknown>,
  fields: Record<string, string>,
): string | undefined {
  const x = firstAxis(built.xAxe);
  const y = firstAxis(built.yAxe);
  if (!x || !y || x === y) return undefined;
  const metricBind = titleMetricField(fields);
  const categoryBind = titleCategoryField(fields);
  if (metricBind && categoryBind && metricBind !== categoryBind) {
    const axes = new Set([x, y]);
    if (axes.has(metricBind) && axes.has(categoryBind)) {
      return `${metricBind} by ${categoryBind}`;
    }
    if (axes.has(categoryBind) && !axes.has(metricBind)) {
      const plottedMetric = x === categoryBind ? y : x;
      return `${plottedMetric} by ${categoryBind}`;
    }
    if (axes.has(metricBind) && !axes.has(categoryBind)) {
      const plottedCategory = y === metricBind ? x : y;
      return `${metricBind} by ${plottedCategory}`;
    }
  }
  return `${y} by ${x}`;
}

/** When flow remaps y, keep from/to but use the plotted metric field. */
function endpointTitleFields(
  built: Record<string, unknown>,
  fields: Record<string, string>,
): Record<string, string> {
  const metricBind = titleMetricField(fields);
  const plottedY = firstAxis(built.yAxe);
  if (!plottedY || !metricBind || plottedY === metricBind) return fields;
  return { ...fields, metric: plottedY, y: plottedY };
}

/** Header title for a built widget object from its binds / plotted axes. */
export function chartPayloadTitle(
  built: Record<string, unknown>,
  binds: WorkspaceSpec['binds'],
): string | undefined {
  const fields = bindFieldMap(binds);
  if (hasEndpointTitleBinds(fields)) {
    const fromEndpoints = labelFromFieldMap(endpointTitleFields(built, fields));
    if (fromEndpoints) return fromEndpoints;
  }
  const fromAxes = titleFromPlottedAxes(built, fields);
  if (fromAxes) return fromAxes;
  return labelFromFieldMap(fields);
}

function withDescriptiveName(
  built: unknown,
  binds: WorkspaceSpec['binds'],
  component: string,
): unknown {
  if (!built || typeof built !== 'object' || Array.isArray(built)) return built;
  const record = built as Record<string, unknown>;
  const title = chartPayloadTitle(record, binds);
  if (!title) return built;
  const current = record.name;
  if (typeof current === 'string' && !isSlugChartName(current, component)) {
    return built;
  }
  return { ...record, name: title };
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
  const built = build(
    chartType ?? chartTypeForComponent(component),
    bindFieldMap(binds),
    rows,
    columns,
  );
  return withDescriptiveName(built, binds, component);
}
