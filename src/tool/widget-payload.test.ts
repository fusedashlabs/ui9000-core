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

  it('returns null when bind fields are not on the rows', () => {
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
    ).toBeNull();
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
          mapType: 'country',
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

  it('stamps the admin level on the choropleth layer, defaulting to country', () => {
    const state = workspaceWidgetPayload(
      'map-chart',
      'mapChart',
      [
        { role: 'geo', field: 'state' },
        { role: 'metric', field: 'n' },
      ],
      [{ state: 'California', n: '1' }],
    ) as { layers: Array<{ mapType?: string }> };
    expect(state.layers[0]?.mapType).toBe('state');

    const codes = workspaceWidgetPayload(
      'map-chart',
      'mapChart',
      [
        { role: 'geo', field: 'state' },
        { role: 'metric', field: 'n' },
      ],
      [{ state: 'CA', n: '1' }],
    ) as { layers: Array<{ data?: Array<{ label: string }> }> };
    expect(codes.layers[0]?.data?.[0]?.label).toBe('CA');

    const place = workspaceWidgetPayload(
      'map-chart',
      'mapChart',
      [
        { role: 'geo', field: 'place' },
        { role: 'metric', field: 'n' },
      ],
      [{ place: 'France', n: '1' }],
    ) as { layers: Array<{ mapType?: string }> };
    expect(place.layers[0]?.mapType).toBe('country');
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

  it('draws a health score as the dial and the other measures as cards', () => {
    expect(
      workspaceWidgetPayload(
        'status-gauge-widget',
        'statusGaugeWidget',
        [],
        [
          { unitHealth: 72.8, txPower: 28, temp: 68 },
        ],
      ),
    ).toMatchObject({
      chartType: 'statusGaugeWidget',
      data: [
        { key: 'unitHealth', role: 'gauge', value: 72.8 },
        { key: 'txPower', role: 'metric', value: 28 },
        { key: 'temp', role: 'metric', value: 68 },
      ],
    });
  });

  it('keeps status rows as cards when no health score is present', () => {
    expect(
      workspaceWidgetPayload(
        'status-gauge-widget',
        'statusGaugeWidget',
        [],
        [
          { key: 'Tx Power', value: 28, unit: 'dBm', min: 0, max: 40 },
          { key: 'Temp', value: 68, unit: '°C' },
        ],
      ),
    ).toMatchObject({
      data: [
        { key: 'txPower', role: 'metric', value: 28, min: 0, max: 40 },
        { key: 'temp', role: 'metric', value: 68 },
      ],
    });
  });

  it('does not invent a dial from a single score column', () => {
    expect(
      workspaceWidgetPayload('status-gauge-widget', 'statusGaugeWidget', [], [{ score: 10 }, { score: 12 }]),
    ).toMatchObject({
      data: [{ key: 'score', role: 'metric', value: 10 }],
    });
  });

  it('averages a score and does not average a name that merely contains those letters', () => {
    const rows = [{ health_score: 2 }, { health_score: 4 }];
    expect(
      workspaceWidgetPayload('kpi-widget', 'KPI', [{ role: 'metric', field: 'health_score' }], rows),
    ).toMatchObject({ items: [{ aggregations: 'avg', data: [{ value: { avg_health_score: 3 } }] }] });
    expect(
      workspaceWidgetPayload('kpi-widget', 'KPI', [{ role: 'metric', field: 'meaningful' }], [
        { meaningful: 2 },
        { meaningful: 4 },
      ]),
    ).toMatchObject({ items: [{ aggregations: 'sum', data: [{ value: { sum_meaningful: 6 } }] }] });
    expect(
      workspaceWidgetPayload('kpi-widget', 'KPI', [{ role: 'metric', field: 'strategy' }], [
        { strategy: 2 },
        { strategy: 4 },
      ]),
    ).toMatchObject({ items: [{ aggregations: 'sum' }] });
  });

  it('takes revenue from the latest month, not the last file row or a date-shaped id', () => {
    const rows = [
      { month: '2024-03', revenue: 5, ticket: '2024-03-441' },
      { month: '2024-01', revenue: 10, ticket: '2024-01-100' },
      { month: '2024-02', revenue: 40, ticket: '2024-04-442' },
      { month: '2024-04', revenue: 'n/a', ticket: '2024-05-500' },
    ];
    expect(
      workspaceWidgetPayload(
        'kpi-widget',
        'KPI',
        [{ role: 'metric', field: 'revenue' }],
        rows,
        [
          { name: 'month', role: 'temporal' },
          { name: 'revenue', role: 'metric' },
          { name: 'ticket', role: 'category' },
        ],
      ),
    ).toMatchObject({ items: [{ aggregations: 'last', data: [{ value: { last_revenue: 5 } }] }] });
    expect(
      workspaceWidgetPayload(
        'kpi-widget',
        'KPI',
        [{ role: 'metric', field: 'revenue' }],
        rows,
        [
          { name: 'revenue', role: 'metric' },
          { name: 'ticket', role: 'category' },
        ],
      ),
    ).toMatchObject({ items: [{ aggregations: 'sum', data: [{ value: { sum_revenue: 55 } }] }] });
  });

  it('orders month names by the calendar, not the alphabet', () => {
    expect(
      workspaceWidgetPayload(
        'kpi-widget',
        'KPI',
        [{ role: 'metric', field: 'revenue' }],
        [
          { month: 'September', revenue: 9 },
          { month: 'zzz', revenue: 99 },
          { month: 'January', revenue: 1 },
          { month: 'December', revenue: 12 },
        ],
        [
          { name: 'month', role: 'temporal' },
          { name: 'revenue', role: 'metric' },
        ],
      ),
    ).toMatchObject({ items: [{ aggregations: 'last', data: [{ value: { last_revenue: 12 } }] }] });
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

  it('draws one line per metric column when a time chart has no series', () => {
    expect(
      workspaceWidgetPayload(
        'line-chart',
        'lineChart',
        [
          { role: 'x', field: 'month' },
          { role: 'y', field: 'active_listings' },
        ],
        [
          { month: 'Jul 2026', active_listings: 2035, pending_sales: 1049 },
          { month: 'Aug 2026', active_listings: 1985, pending_sales: 1002 },
        ],
      ),
    ).toMatchObject({
      chartType: 'lineGroupedChart',
      xAxe: ['month'],
      yAxe: ['value'],
      groupBy: ['measure'],
      data: [
        { month: 'Jul 2026', measure: 'active_listings', value: 2035 },
        { month: 'Jul 2026', measure: 'pending_sales', value: 1049 },
        { month: 'Aug 2026', measure: 'active_listings', value: 1985 },
        { month: 'Aug 2026', measure: 'pending_sales', value: 1002 },
      ],
    });
  });

  it('draws a grouped line from a time axis, a metric, and a series', () => {
    expect(
      workspaceWidgetPayload(
        'line-chart',
        'lineChart',
        [
          { role: 'x', field: 'month' },
          { role: 'y', field: 'incidents' },
          { role: 'series', field: 'team' },
        ],
        [
          { team: 'Alpha', month: '2024-01', incidents: 10 },
          { team: 'Alpha', month: '2024-02', incidents: 12 },
          { team: 'Beta', month: '2024-01', incidents: 4 },
        ],
      ),
    ).toMatchObject({
      chartType: 'lineGroupedChart',
      xAxe: ['month'],
      yAxe: ['incidents'],
      groupBy: ['team'],
    });
  });

  it('draws a pie from a category and a metric', () => {
    expect(
      workspaceWidgetPayload(
        'pie-chart',
        'pieChart',
        [
          { role: 'label', field: 'team' },
          { role: 'y', field: 'score' },
        ],
        [
          { team: 'Alpha', score: 10 },
          { team: 'Alpha', score: 2 },
          { team: 'Beta', score: 4 },
        ],
      ),
    ).toEqual({
      chartType: 'pieChart',
      name: 'pie-chart',
      xAxe: ['team'],
      yAxe: ['score'],
      data: [
        { team: 'Alpha', score: 12 },
        { team: 'Beta', score: 4 },
      ],
    });
  });
});
