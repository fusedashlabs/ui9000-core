import { describe, expect, it } from 'vitest';

import { chartTypeForComponent, workspaceWidgetPayload } from './widget-payload.js';

describe('workspaceWidgetPayload', () => {
  it('maps engine ids to FuseDash chartType when catalog keys are empty', () => {
    expect(chartTypeForComponent('form', [])).toBe('customWidget');
    expect(chartTypeForComponent('network-graph', [])).toBe('networkGraphChart');
    expect(chartTypeForComponent('bar-chart', ['barChart', 'barGrouped'])).toBe('barChart');
    expect(chartTypeForComponent('bar-chart', ['*'])).toBe('barChart');
  });
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
      orientation: 'vertical',
      xAxe: ['team'],
      yAxe: ['incidents'],
      data: [
        { team: 'Search', incidents: 28 },
        { team: 'Payments', incidents: 19 },
      ],
    });
  });

  it('omits groupBy when the series field is the category', () => {
    expect(
      workspaceWidgetPayload(
        'bar-chart',
        'barChart',
        [
          { role: 'category', field: 'pharmacy' },
          { role: 'metric', field: 'compensated_sum' },
          { role: 'series', field: 'pharmacy' },
        ],
        [
          { pharmacy: 'A', compensated_sum: 10 },
          { pharmacy: 'B', compensated_sum: 4 },
        ],
      ),
    ).toEqual({
      chartType: 'barChart',
      name: 'bar-chart',
      orientation: 'vertical',
      xAxe: ['pharmacy'],
      yAxe: ['compensated_sum'],
      data: [
        { pharmacy: 'A', compensated_sum: 10 },
        { pharmacy: 'B', compensated_sum: 4 },
      ],
    });
  });

  it('builds a grouped bar when series is a different column', () => {
    expect(
      workspaceWidgetPayload(
        'bar-chart',
        'barChart',
        [
          { role: 'category', field: 'quarter' },
          { role: 'metric', field: 'revenue' },
          { role: 'series', field: 'region' },
        ],
        [
          { quarter: 'Q1', region: 'North', revenue: 2 },
          { quarter: 'Q1', region: 'South', revenue: 3 },
          { quarter: 'Q2', region: 'North', revenue: 4 },
          { quarter: 'Q2', region: 'South', revenue: 1 },
        ],
      ),
    ).toEqual({
      chartType: 'barGrouped',
      name: 'bar-chart',
      orientation: 'vertical',
      xAxe: ['quarter'],
      yAxe: ['revenue'],
      groupBy: ['region'],
      stacked: false,
      data: [
        { quarter: 'Q1', region: 'North', revenue: 2 },
        { quarter: 'Q1', region: 'South', revenue: 3 },
        { quarter: 'Q2', region: 'North', revenue: 4 },
        { quarter: 'Q2', region: 'South', revenue: 1 },
      ],
    });
  });

  it('turns a long category list horizontal', () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      pharmacy: `P${index}`,
      compensated_sum: index + 1,
    }));
    const payload = workspaceWidgetPayload(
      'bar-chart',
      'barChart',
      [
        { role: 'category', field: 'pharmacy' },
        { role: 'metric', field: 'compensated_sum' },
      ],
      rows,
    ) as { chartType: string; orientation: string; xAxe: string[]; yAxe: string[] };
    expect(payload.chartType).toBe('barHorizontal');
    expect(payload.orientation).toBe('horizontal');
    expect(payload.xAxe).toEqual(['compensated_sum']);
    expect(payload.yAxe).toEqual(['pharmacy']);
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
      layers: [
        {
          name: 'Map',
          visualisationType: 'choropleth',
          geospatialData: ['label'],
          arrangeByMetric: ['value'],
          aggregationFunction: 'sum',
          data: [
            { label: 'France', value: 18 },
            { label: 'Germany', value: 11 },
          ],
        },
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
    ) as {
      chartType: string;
      xAxe: string[];
      yAxe: string[];
      groupBy: string[];
      data: Array<{ histogramResults: Array<{ count: number; _id: Record<string, string> }> }>;
    };
    expect(payload.chartType).toBe('histogramChart');
    expect(payload.xAxe).toEqual(['score']);
    expect(payload.yAxe).toEqual([]);
    expect(payload.groupBy).toEqual([]);
    const results = payload.data[0]!.histogramResults;
    expect(results.every((bin) => typeof bin._id.score === 'string')).toBe(true);
    expect(results.reduce((sum, bin) => sum + bin.count, 0)).toBe(3);
    expect(results.length).toBeGreaterThan(1);
    expect(results.length).toBeLessThan(3);
    expect(results.every((bin) => bin.count > 0)).toBe(true);
  });

  it('drops empty histogram bins', () => {
    const payload = workspaceWidgetPayload(
      'histogram-chart',
      'histogramChart',
      [{ role: 'distribution', field: 'score' }],
      [{ score: '1' }, { score: '1' }, { score: '1' }, { score: '1' }, { score: '10' }],
    ) as { data: Array<{ histogramResults: Array<{ count: number }> }> };
    const results = payload.data[0]!.histogramResults;
    expect(results.every((bin) => bin.count > 0)).toBe(true);
    expect(results.reduce((sum, bin) => sum + bin.count, 0)).toBe(5);
  });

  it('sums a KPI under aggregations_column', () => {
    expect(
      workspaceWidgetPayload(
        'kpi-widget',
        'KPI',
        [{ role: 'metric', field: 'count' }],
        [{ count: '4' }, { count: '9' }],
      ),
    ).toEqual({
      chartType: 'KPI',
      name: 'count',
      items: [
        {
          type: 'single_value',
          name: 'count',
          column: 'count',
          aggregations: 'sum',
          data: [{ value: { sum_count: 13 } }],
        },
      ],
    });
  });

  it('builds a network from two different endpoints and drops a self link', () => {
    expect(
      workspaceWidgetPayload(
        'network-graph',
        'networkGraphChart',
        [
          { role: 'nodes', field: 'source' },
          { role: 'links', field: 'target' },
          { role: 'metric', field: 'sessions' },
        ],
        [
          { source: 'web-01', target: 'db-03', sessions: '10' },
          { source: 'web-01', target: 'web-01', sessions: '99' },
          { source: 'api-07', target: 'db-03', sessions: '4' },
        ],
      ),
    ).toEqual({
      chartType: 'networkGraphChart',
      name: 'network-graph',
      nodes: [
        { id: 'web-01', label: 'web-01', type: 'node' },
        { id: 'db-03', label: 'db-03', type: 'node' },
        { id: 'api-07', label: 'api-07', type: 'node' },
      ],
      links: [
        { id: 'web-01->db-03', source: 'web-01', target: 'db-03', value: 10 },
        { id: 'api-07->db-03', source: 'api-07', target: 'db-03', value: 4 },
      ],
    });
  });
});
