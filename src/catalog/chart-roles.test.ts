import { describe, expect, it } from 'vitest';
import { collectPortMetadata, type PortMetadata } from '@fusedashlabs/widgets/catalog';

import { CHART_FAMILIES, CHART_ROLES, chartLabel, drawingsFor, familiesForChart } from './chart-roles.js';

function chartTypeKeysOf(meta: PortMetadata): string[] {
  const keys = meta.chartTypeKeys;
  if (!Array.isArray(keys)) return [];
  return keys.filter((key): key is string => typeof key === 'string');
}

/** Charts the package can draw. Dispatcher and the custom-widget composer are not charts. */
function widgetChartIds(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const meta of collectPortMetadata()) {
    const keys = chartTypeKeysOf(meta);
    if (keys.length === 0 || keys.includes('*') || meta.id === 'custom-widget') continue;
    out.set(meta.id, keys);
  }
  return out;
}

describe('chart roles', () => {
  const widgets = widgetChartIds();

  it('names every widgets chart, and no chart that widgets does not have', () => {
    expect([...Object.keys(CHART_ROLES)].sort()).toEqual([...widgets.keys()].sort());
  });

  it('keeps each chartType key list aligned with widgets metadata', () => {
    for (const [id, keys] of widgets) {
      expect([...CHART_ROLES[id as keyof typeof CHART_ROLES].chartTypeKeys], id).toEqual(keys);
    }
  });

  it('puts every chart in a family, and every family member exists', () => {
    const seen = new Set<string>();
    for (const family of CHART_FAMILIES) {
      expect(CHART_ROLES[family.main as keyof typeof CHART_ROLES], family.id).toBeTruthy();
      seen.add(family.main);
      for (const alt of family.alternatives) {
        expect(CHART_ROLES[alt.id as keyof typeof CHART_ROLES], `${family.id} ${alt.id}`).toBeTruthy();
        expect(alt.when.trim().length, alt.id).toBeGreaterThan(0);
        seen.add(alt.id);
      }
    }
    expect([...seen].sort()).toEqual([...widgets.keys()].sort());
  });

  it('keeps the dial and the loss indicator as headline alternatives, in that order', () => {
    const drawings = drawingsFor('kpi-widget');
    expect(drawings?.family.id).toBe('headline');
    expect(drawings?.alternatives.map((role) => role.id)).toEqual([
      'status-gauge-widget',
      'loss-indicator',
    ]);
    expect(drawings?.family.alternatives.map((alt) => alt.id)).toEqual([
      'status-gauge-widget',
      'loss-indicator',
    ]);
  });

  it('treats bar as the comparison main, with lollipop, line, and area as the same data', () => {
    const drawings = drawingsFor('bar-chart');
    expect(drawings?.family.id).toBe('category-magnitude');
    expect(drawings?.alternatives.map((role) => role.id)).toEqual([
      'lollipop',
      'line-chart',
      'area-chart',
      'area-grouped-bar-chart',
      'radial-bar-chart',
      'polar-area-chart',
    ]);
    expect(familiesForChart('line-chart').map((family) => family.id).sort()).toEqual([
      'category-magnitude',
      'ordered-series',
    ]);
  });

  it('names a chart by what it shows', () => {
    expect(chartLabel('bar-chart')).toBe('bar chart (compare discrete groups on one metric)');
    expect(chartLabel('map-chart')).toBe('map chart (place a metric on geography)');
    expect(chartLabel('not-a-chart')).toBe('this chart');
  });
});
