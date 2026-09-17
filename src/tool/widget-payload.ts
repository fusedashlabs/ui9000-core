/**
 * FuseDash widget JSON for the hosted MCP App (`ui://ui9000/chart`).
 * Raw table rows are not plottable by `<ui9000-chart-renderer>`.
 * If binds do not match row keys, the original payload is kept.
 */

import { GEO_LAT_NAMES, GEO_LNG_NAMES } from '../profiler/roles.js';
import { normalizeName } from '../profiler/table.js';
import type { SpecBindItem, WorkspaceSpec } from '../spec/workspace-spec.js';
import { countryJoinLabel } from './country-join-label.js';

const CHART_TYPE_BY_COMPONENT: Record<string, string> = {
  'bar-chart': 'barChart',
  'histogram-chart': 'histogramChart',
  'map-chart': 'mapChart',
  'kpi-widget': 'KPI',
  'network-graph': 'networkGraph',
};

export function chartTypeForComponent(
  component: string,
  chartTypeKeys?: readonly string[],
): string | undefined {
  if (chartTypeKeys?.[0]) return chartTypeKeys[0];
  return CHART_TYPE_BY_COMPONENT[component];
}

export function bindFieldMap(
  binds: WorkspaceSpec['binds'],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!binds) return out;
  if (Array.isArray(binds)) {
    for (const item of binds as SpecBindItem[]) {
      if (item?.role && item.field) out[item.role] = item.field;
    }
    return out;
  }
  for (const [role, value] of Object.entries(binds)) {
    const field = typeof value === 'string' ? value : value?.field;
    if (role && field) out[role] = field;
  }
  return out;
}

export function workspaceWidgetPayload(
  component: string,
  chartType: string | undefined,
  binds: WorkspaceSpec['binds'],
  payload: unknown,
): unknown {
  const rows = asRowObjects(payload);
  if (!rows) return payload;
  const fields = bindFieldMap(binds);
  const type = chartType ?? CHART_TYPE_BY_COMPONENT[component];

  if (component === 'map-chart') {
    return mapWidgetPayload(type, component, fields, rows) ?? payload;
  }

  if (component === 'bar-chart') {
    const points = aggregatePoints(rows, fields.category, fields.metric);
    if (!points) return payload;
    return { chartType: type, name: component, data: points };
  }

  if (component === 'histogram-chart') {
    const metricField = fields.distribution ?? fields.metric;
    const values = numericColumn(rows, metricField);
    if (!values) return payload;
    return { chartType: type, name: component, data: histogramBins(values) };
  }

  if (component === 'kpi-widget') {
    const metricField = fields.metric;
    if (!metricField) return payload;
    let total = 0;
    let saw = false;
    for (const row of rows) {
      const n = Number(row[metricField]);
      if (!Number.isFinite(n)) continue;
      total += n;
      saw = true;
    }
    if (!saw) return payload;
    return {
      chartType: 'KPI',
      type: 'single_value',
      name: metricField,
      data: [{ value: total }],
    };
  }

  return payload;
}

function mapWidgetPayload(
  chartType: string | undefined,
  name: string,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const pair = latLngFields(rows[0]!);
  if (pair) {
    const markers: Array<{ point: [number, number]; value: number }> = [];
    for (const row of rows) {
      const lat = Number(row[pair.lat]);
      const lng = Number(row[pair.lng]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const raw = fields.metric ? Number(row[fields.metric]) : 1;
      markers.push({
        point: [lng, lat],
        value: Number.isFinite(raw) ? raw : 1,
      });
    }
    if (markers.length === 0) return null;
    return {
      chartType,
      name,
      layers: [
        {
          name: 'Markers',
          visualisationType: 'markers',
          geospatialData: ['point'],
          arrangeByMetric: ['value'],
          data: markers,
        },
      ],
    };
  }

  const points = aggregatePoints(rows, fields.geo ?? fields.category, fields.metric, countryJoinLabel);
  if (!points) return null;
  return { chartType, name, data: points };
}

function asRowObjects(payload: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const rows: Record<string, unknown>[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    rows.push(item as Record<string, unknown>);
  }
  return rows;
}

function aggregatePoints(
  rows: Record<string, unknown>[],
  labelField: string | undefined,
  metricField: string | undefined,
  relabel: (label: string) => string = (label) => label,
): Array<{ label: string; value: number }> | null {
  if (!labelField || !metricField) return null;
  if (!(labelField in rows[0]!) || !(metricField in rows[0]!)) return null;
  const sums = new Map<string, number>();
  for (const row of rows) {
    const label = relabel(String(row[labelField] ?? '').trim());
    const value = Number(row[metricField]);
    if (!label || !Number.isFinite(value)) continue;
    sums.set(label, (sums.get(label) ?? 0) + value);
  }
  if (sums.size === 0) return null;
  return [...sums.entries()].map(([label, value]) => ({ label, value }));
}

function numericColumn(
  rows: Record<string, unknown>[],
  field: string | undefined,
): number[] | null {
  if (!field || !(field in rows[0]!)) return null;
  const values: number[] = [];
  for (const row of rows) {
    const n = Number(row[field]);
    if (!Number.isFinite(n)) continue;
    values.push(n);
  }
  return values.length > 0 ? values : null;
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

function latLngFields(
  row: Record<string, unknown>,
): { lat: string; lng: string } | null {
  const keys = Object.keys(row);
  const lat = keys.find((key) =>
    (GEO_LAT_NAMES as readonly string[]).includes(normalizeName(key)),
  );
  const lng = keys.find((key) =>
    (GEO_LNG_NAMES as readonly string[]).includes(normalizeName(key)),
  );
  return lat && lng ? { lat, lng } : null;
}
