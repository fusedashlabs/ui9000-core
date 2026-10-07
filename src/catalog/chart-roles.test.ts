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

/** Widgets charts core does not select yet. The PR that adds one to CHART_ROLES removes it here. */
const PENDING_IN_CORE = [
  'component-asset-card',
  'flow-sankey-chart',
  'incidents-review-card',
];

describe('chart roles', () => {
  const widgets = widgetChartIds();
  const named = [...widgets.keys()].filter((id) => !PENDING_IN_CORE.includes(id));

  it('names every widgets chart or lists it as pending, and no chart that widgets does not have', () => {
    expect(
      Object.keys(CHART_ROLES).filter((id) => !widgets.has(id)),
      'core names a chart widgets does not have',
    ).toEqual([]);
    expect(
      PENDING_IN_CORE.filter((id) => id in CHART_ROLES),
      'core now names these, so remove them from PENDING_IN_CORE',
    ).toEqual([]);
    expect(
      [...widgets.keys()].filter((id) => !(id in CHART_ROLES)).sort(),
      'widgets charts core does not name must be listed in PENDING_IN_CORE',
    ).toEqual([...PENDING_IN_CORE].sort());
  });

  it('keeps each chartType key list aligned with widgets metadata', () => {
    for (const id of named) {
      expect([...CHART_ROLES[id as keyof typeof CHART_ROLES].chartTypeKeys], id).toEqual(widgets.get(id));
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
    expect([...seen].sort()).toEqual([...named].sort());
  });

  it('keeps the dial, the loss indicator, and the power path card as headline alternatives, in that order', () => {
    const drawings = drawingsFor('kpi-widget');
    expect(drawings?.family.id).toBe('headline');
    expect(drawings?.alternatives.map((role) => role.id)).toEqual([
      'status-gauge-widget',
      'loss-indicator',
      'power-path-card',
    ]);
    expect(drawings?.family.alternatives.map((alt) => alt.id)).toEqual([
      'status-gauge-widget',
      'loss-indicator',
      'power-path-card',
    ]);
  });

  it('keeps pie as the part-to-whole main, with the band as a later alternative', () => {
    const drawings = drawingsFor('pie-chart');
    expect(drawings?.family.id).toBe('part-to-whole');
    expect(drawings?.family.main).toBe('pie-chart');
    expect(drawings?.alternatives.map((role) => role.id)).toEqual([
      'donut-chart',
      'treemap-chart',
      'band-utilization-chart',
    ]);
    expect(familiesForChart('band-utilization-chart').map((family) => family.id)).toEqual([
      'part-to-whole',
    ]);
    expect(chartLabel('band-utilization-chart')).toBe(
      'band utilization chart (show the same share breakdown once per entity)',
    );
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

  it('keeps the power path card in the headline family only, as an alternative to KPI', () => {
    expect(drawingsFor('power-path-card')).toBeUndefined();
    expect(familiesForChart('power-path-card').map((family) => family.id)).toEqual(['headline']);
    const headline = CHART_FAMILIES.find((family) => family.id === 'headline');
    const when = headline?.alternatives.find((alt) => alt.id === 'power-path-card')?.when;
    expect(when).toContain('already has a health score');
    expect(when).toContain('each with a status');
    expect(when).toContain('Do not invent the score');
    expect(CHART_ROLES['power-path-card'].chartTypeKeys).toEqual(['powerPathCard']);
  });

  it('names a chart by what it shows', () => {
    expect(chartLabel('bar-chart')).toBe('bar chart (compare discrete groups on one metric)');
    expect(chartLabel('map-chart')).toBe('map chart (place a metric on geography)');
    expect(chartLabel('not-a-chart')).toBe('this chart');
  });
});
