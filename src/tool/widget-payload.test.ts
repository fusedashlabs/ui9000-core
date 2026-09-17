import { describe, expect, it } from 'vitest';

import { workspaceWidgetPayload } from './widget-payload.js';

describe('workspaceWidgetPayload', () => {
  it('aggregates category × metric into FuseDash bar points', () => {
    expect(
      workspaceWidgetPayload(
        'bar-chart',
        'barChart',
        [
          { role: 'category', field: 'team' },
          { role: 'metric', field: 'incidents' },
        ],
        [
          { team: 'Search', incidents: '22' },
          { team: 'Search', incidents: '6' },
          { team: 'Payments', incidents: '19' },
        ],
      ),
    ).toEqual({
      chartType: 'barChart',
      name: 'bar-chart',
      data: [
        { label: 'Search', value: 28 },
        { label: 'Payments', value: 19 },
      ],
    });
  });

  it('keeps the original payload when bind fields are not on the rows', () => {
    const rows = [{ region: 'secret-north', value: 99 }];
    expect(
      workspaceWidgetPayload(
        'bar-chart',
        'barChart',
        [
          { role: 'category', field: 'category' },
          { role: 'metric', field: 'metric' },
        ],
        rows,
      ),
    ).toBe(rows);
  });

  it('joins ISO-2 country codes onto Natural Earth names', () => {
    expect(
      workspaceWidgetPayload(
        'map-chart',
        'mapChart',
        [
          { role: 'geo', field: 'country' },
          { role: 'metric', field: 'incidents' },
        ],
        [
          { country: 'FR', incidents: '12' },
          { country: 'FR', incidents: '6' },
          { country: 'DE', incidents: '11' },
        ],
      ),
    ).toEqual({
      chartType: 'mapChart',
      name: 'map-chart',
      data: [
        { label: 'France', value: 18 },
        { label: 'Germany', value: 11 },
      ],
    });
  });

  it('emits lat/lng marker layers instead of choropleth labels', () => {
    expect(
      workspaceWidgetPayload(
        'map-chart',
        'mapChart',
        [
          { role: 'geo', field: 'lat' },
          { role: 'metric', field: 'readings' },
        ],
        [
          { site: 'Harbour', lat: '51.5074', lng: '-0.1278', readings: '42' },
          { site: 'Dockside', lat: '53.4808', lng: '-2.2426', readings: '17' },
        ],
      ),
    ).toEqual({
      chartType: 'mapChart',
      name: 'map-chart',
      layers: [
        {
          name: 'Markers',
          visualisationType: 'markers',
          geospatialData: ['point'],
          arrangeByMetric: ['value'],
          data: [
            { point: [-0.1278, 51.5074], value: 42 },
            { point: [-2.2426, 53.4808], value: 17 },
          ],
        },
      ],
    });
  });

  it('bins histogram samples instead of emitting one bar per row', () => {
    const payload = workspaceWidgetPayload(
      'histogram-chart',
      'histogramChart',
      [{ role: 'distribution', field: 'score' }],
      [{ score: '1' }, { score: '4' }, { score: '4' }],
    ) as { chartType: string; data: Array<{ label: string; value: number }> };
    expect(payload.chartType).toBe('histogramChart');
    expect(payload.data.every((bin) => typeof bin.label === 'string')).toBe(true);
    expect(payload.data.reduce((sum, bin) => sum + bin.value, 0)).toBe(3);
    expect(payload.data.length).toBeGreaterThan(1);
    expect(payload.data.length).toBeLessThan(3);
    expect(payload.data.every((bin) => bin.value > 0)).toBe(true);
  });

  it('drops empty histogram bins', () => {
    const payload = workspaceWidgetPayload(
      'histogram-chart',
      'histogramChart',
      [{ role: 'distribution', field: 'score' }],
      [{ score: '1' }, { score: '1' }, { score: '1' }, { score: '1' }, { score: '10' }],
    ) as { data: Array<{ label: string; value: number }> };
    expect(payload.data.every((bin) => bin.value > 0)).toBe(true);
    expect(payload.data.reduce((sum, bin) => sum + bin.value, 0)).toBe(5);
  });
});
