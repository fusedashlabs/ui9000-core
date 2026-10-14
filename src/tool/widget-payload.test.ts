import { describe, expect, it } from 'vitest';

import { classifyColumns } from '../profiler/roles.js';
import { parseCsvTable, tableToRows } from '../profiler/table.js';
import { flowSankeyFits } from './payload/flow-sankey-chart.js';
import { chartTypeForComponent, workspaceWidgetPayload } from './widget-payload.js';

/** Rows plus the profiler's column roles, the way show_workspace passes them. */
function flowTable(csv: string) {
  const table = parseCsvTable(csv);
  return {
    rows: tableToRows(table),
    hints: classifyColumns(table).columns.map((column) => ({
      name: column.column.name,
      role: column.role,
    })),
  };
}

const LINK_BINDS = [
  { role: 'source', field: 'source' },
  { role: 'target', field: 'target' },
  { role: 'y', field: 'event_count' },
];

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

  it('does not turn the scale columns into dial cards', () => {
    const payload = workspaceWidgetPayload(
      'status-gauge-widget',
      'statusGaugeWidget',
      [],
      [{ unitHealth: 72.8, txPower: 28, min: 0, max: 100, okTo: 80 }],
    ) as { data: Array<{ key: string; role: string; value: number }> };
    expect(payload.data).toEqual([
      { key: 'unitHealth', role: 'gauge', value: 72.8 },
      { key: 'txPower', role: 'metric', value: 28 },
    ]);
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

  it('builds a loss indicator from one scaled metric and its thresholds', () => {
    const payload = workspaceWidgetPayload(
      'loss-indicator',
      'lossIndicator',
      [],
      [
        {
          label: 'Electrical Loss',
          value: 24.3,
          unit: '%',
          min: 0,
          max: 30,
          ticks: '0,10,20,30',
          okTo: 10,
          warningTo: 20,
          trend: 'down',
        },
      ],
    );
    expect(payload).toMatchObject({
      chartType: 'lossIndicator',
      name: 'Electrical Loss',
      yAxe: ['value'],
      data: [{ value: 24.3, trend: 'down', ticks: [0, 10, 20, 30] }],
      axisDetails: {
        value: { label: 'Electrical Loss', measure_unit: '%' },
      },
      limitsDomains: [[0, 30]],
      domainsLimits: [
        { values: [0, 10], color: '#3ad07c', level: 'ok', orientation: 'horizontal' },
        { values: [10, 20], color: '#f5c451', level: 'warning', orientation: 'horizontal' },
        { values: [20, 30], color: '#ef3b4a', level: 'critical', orientation: 'horizontal' },
      ],
    });
    expect(payload).not.toHaveProperty('uniqueValues');
  });

  it('does not build a loss indicator from two metrics', () => {
    expect(
      workspaceWidgetPayload('loss-indicator', 'lossIndicator', [], [{ loss: 24.3, noise: 1, min: 0, max: 30, okTo: 10 }]),
    ).toBeNull();
  });

  it('does not invent a dial from a single score column', () => {
    expect(
      workspaceWidgetPayload('status-gauge-widget', 'statusGaugeWidget', [], [{ score: 10 }, { score: 12 }]),
    ).toMatchObject({
      data: [{ key: 'score', role: 'metric', value: 10 }],
    });
  });

  const POWER_PATH_ROWS = [
    {
      power_path: 'Sector 1 Power Path',
      asset: '5G-TX-303',
      metric: 'Electricity Health',
      value: 69.9,
      unit: '%',
      status: 'Critical',
      points: '72.8 73.6 75.1 74.3 70.8 69.9',
      fault: 'Critical fault detected · Circuit L2 · RF Line 3 · Downtime 24 sec',
    },
    { power_path: 'Sector 1 Power Path', asset: '5G-TX-303', metric: 'Input Voltage', value: 48.1, unit: 'V', status: 'Stable', points: '', fault: '' },
    { power_path: 'Sector 1 Power Path', asset: '5G-TX-303', metric: 'Output Voltage', value: 36.4, unit: 'V', status: 'Critical', points: '', fault: '' },
    { power_path: 'Sector 1 Power Path', asset: '5G-TX-303', metric: 'Current Draw', value: 18.7, unit: 'A', status: 'Critical', points: '', fault: '' },
    { power_path: 'Sector 1 Power Path', asset: '5G-TX-303', metric: 'Power Loss', value: 24.3, unit: '%', status: 'High', points: '', fault: '' },
    { power_path: 'Sector 1 Power Path', asset: '5G-TX-303', metric: 'Connector Temperature', value: 63, unit: '°C', status: 'Critical', points: '', fault: '' },
  ];

  it('sends the power path card the badge, the health score with its points, the fault, and the metric rows', () => {
    expect(workspaceWidgetPayload('power-path-card', 'powerPathCard', [], POWER_PATH_ROWS)).toEqual({
      chartType: 'powerPathCard',
      name: 'Sector 1 Power Path',
      badge: '5G-TX-303',
      health: {
        label: 'Electricity Health',
        value: 69.9,
        unit: '%',
        status: 'Critical',
        points: [72.8, 73.6, 75.1, 74.3, 70.8, 69.9],
      },
      fault: {
        active: true,
        message: 'Critical fault detected · Circuit L2 · RF Line 3 · Downtime 24 sec',
      },
      data: [
        { key: 'inputVoltage', label: 'Input Voltage', value: 48.1, unit: 'V', status: 'Stable' },
        { key: 'outputVoltage', label: 'Output Voltage', value: 36.4, unit: 'V', status: 'Critical' },
        { key: 'currentDraw', label: 'Current Draw', value: 18.7, unit: 'A', status: 'Critical' },
        { key: 'powerLoss', label: 'Power Loss', value: 24.3, unit: '%', status: 'High' },
        { key: 'connectorTemperature', label: 'Connector Temperature', value: 63, unit: '°C', status: 'Critical' },
      ],
    });
  });

  it('leaves out the power path fault and points when the table has none', () => {
    const rows = POWER_PATH_ROWS.map((row) => ({ ...row, points: '', fault: 'none' }));
    const payload = workspaceWidgetPayload('power-path-card', 'powerPathCard', [], rows) as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('fault');
    expect(payload.health).toEqual({ label: 'Electricity Health', value: 69.9, unit: '%', status: 'Critical' });
  });

  it('does not invent a power path health score', () => {
    const rows = POWER_PATH_ROWS.slice(1);
    const payload = workspaceWidgetPayload('power-path-card', 'powerPathCard', [], rows) as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('health');
    expect(payload.data).toHaveLength(5);
  });

  it('sends power path thresholds and keeps a row without status bare', () => {
    expect(
      workspaceWidgetPayload(
        'power-path-card',
        'powerPathCard',
        [],
        [
          { metric: 'Health', value: 80 },
          { metric: 'Input Voltage', value: 44, unit: 'V', warning: 46, critical: 42, direction: 'below' },
          { metric: 'Uptime', value: 99.2, unit: '%' },
        ],
      ),
    ).toMatchObject({
      name: 'Power Path',
      health: { label: 'Health', value: 80 },
      data: [
        { key: 'inputVoltage', thresholds: { warning: 46, critical: 42, direction: 'below' } },
        { key: 'uptime', label: 'Uptime', value: 99.2, unit: '%' },
      ],
    });
  });

  it('refuses one power path card for several equipment groups', () => {
    const rows = [
      { asset: '5G-TX-303', metric: 'Health', value: 70, status: 'High' },
      { asset: '5G-TX-404', metric: 'Health', value: 90, status: 'Stable' },
    ];
    expect(workspaceWidgetPayload('power-path-card', 'powerPathCard', [], rows)).toBeNull();
  });

  const COMPONENT_ASSET_ROW = {
    name: 'Sector A1 Antenna',
    asset_id: 'RTX-3090',
    image: 'https://assets.example/sector-antenna.png',
    metric: 'Packet loss',
    value: 1.02,
    unit: '%',
    delta: 0.8,
    reference: 'vs 30m ago',
    points: '2.4 1.9 1.6 1.4 1.1 1.02',
  };

  it('sends the component asset card the name, the id, the image, one metric, the delta, and the points', () => {
    expect(
      workspaceWidgetPayload('component-asset-card', 'componentAssetCard', [], [COMPONENT_ASSET_ROW]),
    ).toEqual({
      chartType: 'componentAssetCard',
      name: 'Sector A1 Antenna',
      assetId: 'RTX-3090',
      image: { src: 'https://assets.example/sector-antenna.png', alt: 'Sector A1 Antenna' },
      metric: { label: 'Packet loss', value: 1.02, unit: '%' },
      delta: { value: 0.8, label: 'vs 30m ago' },
      trend: [2.4, 1.9, 1.6, 1.4, 1.1, 1.02],
    });
  });

  it('keeps the component asset name, id, and value without an image, a delta, or points', () => {
    const { image, delta, reference, points, ...row } = COMPONENT_ASSET_ROW;
    void image;
    void delta;
    void reference;
    void points;
    expect(workspaceWidgetPayload('component-asset-card', 'componentAssetCard', [], [row])).toEqual({
      chartType: 'componentAssetCard',
      name: 'Sector A1 Antenna',
      assetId: 'RTX-3090',
      metric: { label: 'Packet loss', value: 1.02, unit: '%' },
    });
  });

  it('reads the one numeric column as the component asset metric, with a level and thresholds', () => {
    expect(
      workspaceWidgetPayload(
        'component-asset-card',
        'componentAssetCard',
        [],
        [{ device: 'RTX-3090', packet_loss: '1.02', status: 'Critical', warning: 0.5, critical: 1, better: 'down' }],
      ),
    ).toEqual({
      chartType: 'componentAssetCard',
      assetId: 'RTX-3090',
      metric: {
        label: 'packet loss',
        value: 1.02,
        level: 'critical',
        thresholds: { warning: 0.5, critical: 1 },
      },
    });
  });

  it('leaves out a component asset status it cannot read and a trend of one point', () => {
    const payload = workspaceWidgetPayload('component-asset-card', 'componentAssetCard', [], [
      { ...COMPONENT_ASSET_ROW, status: 'Unknown', points: '1.02' },
    ]) as Record<string, unknown>;
    expect(payload.metric).toEqual({ label: 'Packet loss', value: 1.02, unit: '%' });
    expect(payload).not.toHaveProperty('trend');
  });

  it('refuses one component asset card for several rows or several metrics', () => {
    expect(
      workspaceWidgetPayload('component-asset-card', 'componentAssetCard', [], [
        COMPONENT_ASSET_ROW,
        { ...COMPONENT_ASSET_ROW, asset_id: 'RTX-4090' },
      ]),
    ).toBeNull();
    expect(
      workspaceWidgetPayload('component-asset-card', 'componentAssetCard', [], [
        { asset_id: 'RTX-3090', packet_loss: 1.02, latency: 14 },
      ]),
    ).toBeNull();
  });

  const INCIDENT_ROWS = [
    { status: 'Active', incidents: 89, radius_km: 5 },
    { status: 'In progress', incidents: 46, radius_km: 5 },
    { status: 'Total', incidents: 102, radius_km: 5 },
  ];

  it('sends the incidents review card the title, the filter, the counts, the total, and the track', () => {
    expect(workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], INCIDENT_ROWS)).toEqual({
      chartType: 'incidentsReviewCard',
      title: 'Incidents review',
      filter: { label: '5 km', kind: 'radius' },
      counts: [
        { label: 'Active', value: 89 },
        { label: 'In progress', value: 46 },
      ],
      total: 102,
      track: true,
    });
  });

  it('keeps incident counts that do not sum to the total, and sends no filter without one', () => {
    const rows = INCIDENT_ROWS.map(({ radius_km, ...row }) => {
      void radius_km;
      return row;
    });
    const payload = workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], rows) as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('filter');
    expect(payload.total).toBe(102);
  });

  it('reads one row of incident columns, a named scope, a title, and tones', () => {
    expect(
      workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], [
        { title: 'Network incidents', site: 'North-07', active_incidents: 89, incidents_in_progress: '46', incidents: 102 },
      ]),
    ).toEqual({
      chartType: 'incidentsReviewCard',
      title: 'Network incidents',
      filter: { label: 'North-07', kind: 'site' },
      counts: [
        { label: 'Active', value: 89 },
        { label: 'In progress', value: 46 },
      ],
      total: 102,
      track: true,
    });
    const toned = workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], [
      { incident_status: 'Open', count: 3, color: 'Amber' },
      { incident_status: 'Closed', count: 9, color: 'green' },
    ]) as { counts: unknown };
    expect(toned.counts).toEqual([
      { label: 'Open', value: 3, tone: 'amber' },
      { label: 'Closed', value: 9, tone: 'green' },
    ]);
  });

  it('turns the track off for categories that are not a lifecycle, or when the table says so', () => {
    const severity = workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], [
      { severity: 'Critical', incidents: 4 },
      { severity: 'Major', incidents: 11 },
    ]) as Record<string, unknown>;
    expect(severity.track).toBe(false);
    const off = workspaceWidgetPayload(
      'incidents-review-card',
      'incidentsReviewCard',
      [],
      INCIDENT_ROWS.map((row) => ({ ...row, lifecycle: 'no' })),
    ) as Record<string, unknown>;
    expect(off.track).toBe(false);
    expect(off.counts).toHaveLength(2);
    // A `lifecycle` flag before the state column is still the flag, not the states.
    const flagFirst = workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], [
      { lifecycle: 'no', status: 'Active', incidents: 89 },
      { lifecycle: 'no', status: 'In progress', incidents: 46 },
    ]) as Record<string, unknown>;
    expect(flagFirst.counts).toEqual([
      { label: 'Active', value: 89 },
      { label: 'In progress', value: 46 },
    ]);
    expect(flagFirst.track).toBe(false);
  });

  it('turns the track off for one row of severity columns, and on for one row of lifecycle columns', () => {
    const severity = workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], [
      { critical_incidents: 4, major_incidents: 11, total_incidents: 15 },
    ]) as Record<string, unknown>;
    expect(severity.counts).toEqual([
      { label: 'Critical', value: 4 },
      { label: 'Major', value: 11 },
    ]);
    expect(severity.track).toBe(false);
    const mixed = workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], [
      { active_incidents: 89, critical_incidents: 4 },
    ]) as Record<string, unknown>;
    expect(mixed.track).toBe(false);
    const lifecycle = workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], [
      { new_incidents: 14, acknowledged_incidents: 9, resolved_incidents: 31 },
    ]) as Record<string, unknown>;
    expect(lifecycle.track).toBe(true);
    const asked = workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], [
      { critical_incidents: 4, major_incidents: 11, track: 'yes' },
    ]) as Record<string, unknown>;
    expect(asked.track).toBe(true);
  });

  it('refuses the incidents review card without incidents, with mixed scopes, or with one number', () => {
    const build = (rows: Record<string, unknown>[]) =>
      workspaceWidgetPayload('incidents-review-card', 'incidentsReviewCard', [], rows);
    expect(build([{ status: 'Active', count: 1 }, { status: 'Done', count: 2 }])).toBeNull();
    expect(build([{ active: 89, in_progress: 46 }])).toBeNull();
    expect(build([{ active_incidents: 89, temperature: 21 }])).toBeNull();
    expect(build([{ status: 'Active', incidents: 1, region: 'North' }, { status: 'Done', incidents: 2, region: 'South' }])).toBeNull();
    expect(build([{ status: 'Active', incidents: 1 }, { status: 'Active', incidents: 2 }])).toBeNull();
    expect(build([{ incidents: 102 }])).toBeNull();
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
    ).toMatchObject({
      items: [
        {
          type: 'trend',
          aggregations: 'last',
          showPercentage: true,
          data: [{ last_revenue: 5, percentage: -87.5, subtitle: 'vs previous period' }],
        },
      ],
    });
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
    ).toMatchObject({
      items: [
        {
          type: 'trend',
          aggregations: 'last',
          data: [{ last_revenue: 12, percentage: 33.33 }],
        },
      ],
    });
  });

  it('states the high and low of a category, and does not rank an id', () => {
    expect(
      workspaceWidgetPayload(
        'kpi-widget',
        'KPI',
        [{ role: 'metric', field: 'revenue' }],
        [
          { region: 'West', revenue: 4 },
          { region: 'East', revenue: 9 },
          { region: 'East', revenue: 1 },
        ],
        [
          { name: 'region', role: 'category' },
          { name: 'revenue', role: 'metric' },
        ],
      ),
    ).toMatchObject({
      items: [
        {
          type: 'high/low_overall',
          groupBy: 'region',
          aggregations: 'sum',
          data: [
            {
              high: { region: 'East', sum_revenue: 10 },
              low: { region: 'West', sum_revenue: 4 },
            },
          ],
        },
      ],
    });
  });

  it('sums every row in a period, and still ranks Room 101 against District 100', () => {
    expect(
      workspaceWidgetPayload(
        'kpi-widget',
        'KPI',
        [{ role: 'metric', field: 'revenue' }],
        [
          { month: '2024-01', revenue: 10, ticket: '2024-01-100' },
          { month: '2024-01', revenue: 5, ticket: '2024-01-101' },
          { month: '2024-02', revenue: 20, ticket: '2024-02-100' },
          { month: '2024-02', revenue: 20, ticket: '2024-02-101' },
        ],
        [
          { name: 'month', role: 'temporal' },
          { name: 'ticket', role: 'category' },
          { name: 'revenue', role: 'metric' },
        ],
      ),
    ).toMatchObject({
      items: [
        {
          type: 'trend',
          data: [{ last_revenue: 40, percentage: 166.67 }],
        },
      ],
    });
    expect(
      workspaceWidgetPayload(
        'kpi-widget',
        'KPI',
        [{ role: 'metric', field: 'revenue' }],
        [
          { month: '2024-01', region: 'West', revenue: 10 },
          { month: '2024-01', region: 'East', revenue: 5 },
          { month: '2024-02', region: 'West', revenue: 20 },
          { month: '2024-02', region: 'East', revenue: 20 },
        ],
        [
          { name: 'month', role: 'temporal' },
          { name: 'region', role: 'category' },
          { name: 'revenue', role: 'metric' },
        ],
      ),
    ).toMatchObject({
      items: [
        {
          type: 'high/low_overall',
          groupBy: 'region',
          data: [
            {
              high: { region: 'West', sum_revenue: 30 },
              low: { region: 'East', sum_revenue: 25 },
            },
          ],
        },
      ],
    });
    expect(
      workspaceWidgetPayload(
        'kpi-widget',
        'KPI',
        [{ role: 'metric', field: 'revenue' }],
        [
          { zone: 'Room 101', revenue: 2 },
          { zone: 'Room 101', revenue: 3 },
          { zone: 'District 100', revenue: 9 },
        ],
        [
          { name: 'zone', role: 'category' },
          { name: 'revenue', role: 'metric' },
        ],
      ),
    ).toMatchObject({
      items: [
        {
          type: 'high/low_overall',
          groupBy: 'zone',
          data: [
            {
              high: { zone: 'District 100', sum_revenue: 9 },
              low: { zone: 'Room 101', sum_revenue: 5 },
            },
          ],
        },
      ],
    });
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

  it('draws a band from an entity, a segment, and a share of that row', () => {
    expect(
      workspaceWidgetPayload(
        'band-utilization-chart',
        'bandUtilizationChart',
        [
          { role: 'label', field: 'sector' },
          { role: 'series', field: 'band' },
          { role: 'y', field: 'share' },
        ],
        [
          { sector: 'A1', band: 'Low', share: '22', title: 'Band Utilization by Sector' },
          { sector: 'A1', band: 'Medium', share: '48', title: 'Band Utilization by Sector' },
          { sector: 'A1', band: 'High', share: '30', title: 'Band Utilization by Sector' },
          { sector: 'B1', band: 'Low', share: '18', title: 'Band Utilization by Sector' },
          { sector: 'B1', band: 'Medium', share: '52', title: 'Band Utilization by Sector' },
          { sector: 'B1', band: 'High', share: '30', title: 'Band Utilization by Sector' },
        ],
      ),
    ).toEqual({
      chartType: 'bandUtilizationChart',
      name: 'Band Utilization by Sector',
      yAxe: ['sector'],
      xAxe: ['share'],
      groupBy: ['band'],
      uniqueValues: {
        sector: ['A1', 'B1'],
        band: ['Low', 'Medium', 'High'],
      },
      axisDetails: {
        share: {
          label: 'Percent',
          type: 'number',
          subtype: 'percentage',
          measure_unit_type: 'percentage',
          measure_unit_symbol: '%',
        },
      },
      data: [
        { sector: 'A1', band: 'Low', share: 22 },
        { sector: 'A1', band: 'Medium', share: 48 },
        { sector: 'A1', band: 'High', share: 30 },
        { sector: 'B1', band: 'Low', share: 18 },
        { sector: 'B1', band: 'Medium', share: 52 },
        { sector: 'B1', band: 'High', share: 30 },
      ],
    });
  });

  it('draws the share that sums to a whole when an earlier number does not', () => {
    expect(
      workspaceWidgetPayload(
        'band-utilization-chart',
        'bandUtilizationChart',
        [
          { role: 'label', field: 'sector' },
          { role: 'series', field: 'band' },
          { role: 'y', field: 'weight' },
        ],
        [
          { sector: 'A1', band: 'Low', weight: 1, share: 22 },
          { sector: 'A1', band: 'Medium', weight: 2, share: 48 },
          { sector: 'A1', band: 'High', weight: 3, share: 30 },
          { sector: 'B1', band: 'Low', weight: 4, share: 18 },
          { sector: 'B1', band: 'Medium', weight: 5, share: 52 },
          { sector: 'B1', band: 'High', weight: 6, share: 30 },
        ],
      ),
    ).toMatchObject({
      yAxe: ['sector'],
      xAxe: ['share'],
      groupBy: ['band'],
      data: [
        { sector: 'A1', band: 'Low', share: 22 },
        { sector: 'A1', band: 'Medium', share: 48 },
        { sector: 'A1', band: 'High', share: 30 },
        { sector: 'B1', band: 'Low', share: 18 },
        { sector: 'B1', band: 'Medium', share: 52 },
        { sector: 'B1', band: 'High', share: 30 },
      ],
    });
  });

  it('keeps the bound share when the named chart row does not sum to a whole', () => {
    expect(
      workspaceWidgetPayload(
        'band-utilization-chart',
        'bandUtilizationChart',
        [
          { role: 'label', field: 'sector' },
          { role: 'series', field: 'band' },
          { role: 'y', field: 'share' },
        ],
        [
          { sector: 'A1', band: 'Low', share: 40 },
          { sector: 'A1', band: 'High', share: 10 },
          { sector: 'B1', band: 'Low', share: 20 },
          { sector: 'B1', band: 'High', share: 20 },
        ],
      ),
    ).toMatchObject({
      yAxe: ['sector'],
      xAxe: ['share'],
      groupBy: ['band'],
    });
  });

  it('draws a wide band when each metric column is a share of the row', () => {
    expect(
      workspaceWidgetPayload(
        'band-utilization-chart',
        'bandUtilizationChart',
        [
          { role: 'label', field: 'sector' },
          { role: 'y', field: 'Low' },
        ],
        [
          { sector: 'A1', Low: 22, Medium: 48, High: 30, unit: '%' },
          { sector: 'B1', Low: 18, Medium: 52, High: 30, unit: '%' },
        ],
      ),
    ).toMatchObject({
      chartType: 'bandUtilizationChart',
      xAxe: ['sector'],
      yAxe: ['Low', 'Medium', 'High'],
      axisDetails: {
        Low: { measure_unit_symbol: '%' },
        High: { measure_unit_symbol: '%' },
      },
      data: [
        { sector: 'A1', Low: 22, Medium: 48, High: 30 },
        { sector: 'B1', Low: 18, Medium: 52, High: 30 },
      ],
    });
  });
});

describe('flow-sankey-chart payload', () => {
  const fourStages = [
    'source,target,event_count,severity',
    'Power Loss,Cable Loss,58,medium',
    'Power Loss,Connector Loss,42,medium',
    'Cable Loss,Cable Damage,14,medium',
    'Connector Loss,Lose Connector,20,medium',
    'Cable Damage,Output Voltage Low,14,high',
    'Lose Connector,Output Voltage Low,20,high',
  ].join('\n');

  it('stages a link table by its longest path and keeps the severity on each link', () => {
    const { rows, hints } = flowTable(fourStages);
    expect(
      workspaceWidgetPayload('flow-sankey-chart', 'flowSankeyChart', LINK_BINDS, rows, hints),
    ).toEqual({
      chartType: 'flowSankeyChart',
      name: 'flow-sankey-chart',
      stages: ['', '', '', ''],
      nodes: [
        { id: 'Power Loss', label: 'Power Loss', stage: 0, value: 100, share: 1 },
        { id: 'Cable Loss', label: 'Cable Loss', stage: 1, value: 58, share: 0.58 },
        { id: 'Connector Loss', label: 'Connector Loss', stage: 1, value: 42, share: 0.42 },
        { id: 'Cable Damage', label: 'Cable Damage', stage: 2, value: 14, share: 0.2414 },
        { id: 'Lose Connector', label: 'Lose Connector', stage: 2, value: 20, share: 0.4762 },
        { id: 'Output Voltage Low', label: 'Output Voltage Low', stage: 3, value: 34, share: 0.34 },
      ],
      links: [
        { source: 'Power Loss', target: 'Cable Loss', value: 58, severity: 'medium' },
        { source: 'Power Loss', target: 'Connector Loss', value: 42, severity: 'medium' },
        { source: 'Cable Loss', target: 'Cable Damage', value: 14, severity: 'medium' },
        { source: 'Connector Loss', target: 'Lose Connector', value: 20, severity: 'medium' },
        { source: 'Cable Damage', target: 'Output Voltage Low', value: 14, severity: 'high' },
        { source: 'Lose Connector', target: 'Output Voltage Low', value: 20, severity: 'high' },
      ],
      valueLabel: 'Event Count',
      summary: [{ label: 'Total Event Count', value: '100', caption: '', icon: 'list' }],
    });
    expect(flowSankeyFits(rows, hints)).toBe(true);
  });

  it('reads one category column per stage, and keeps a label that sits in two stages apart', () => {
    const { rows, hints } = flowTable(
      [
        'date,root_cause_category,subcategory,specific_cause,impact,event_count,severity',
        '2026-06-23,Power Loss,Cable Loss,Cable Damage,Output Voltage Low,14,medium',
        '2026-06-25,Power Loss,Connector Loss,Lose Connector,Output Voltage Low,20,medium',
        '2026-06-27,Connector Temp,Filter Loss,Filter Loss,Output Voltage High,14,low',
        '2026-06-29,Power Loss,Cable Loss,Cable Damage,Output Voltage Low,6,medium',
      ].join('\n'),
    );
    const payload = workspaceWidgetPayload(
      'flow-sankey-chart',
      'flowSankeyChart',
      [
        { role: 'source', field: 'root_cause_category' },
        { role: 'target', field: 'subcategory' },
        { role: 'y', field: 'event_count' },
      ],
      rows,
      hints,
    ) as {
      stages: string[];
      nodes: { id: string; label: string; stage: number }[];
      links: { source: string; target: string; value: number; severity?: string }[];
      summary: unknown[];
    };
    expect(payload.stages).toEqual(['Root Cause Category', 'Subcategory', 'Specific Cause', 'Impact']);
    expect(payload.nodes.filter((node) => node.label === 'Filter Loss')).toEqual([
      expect.objectContaining({ id: '1:Filter Loss', stage: 1 }),
      expect.objectContaining({ id: '2:Filter Loss', stage: 2 }),
    ]);
    expect(payload.links).toContainEqual({
      source: '0:Power Loss',
      target: '1:Cable Loss',
      value: 20,
      severity: 'medium',
    });
    expect(payload.links).toContainEqual({
      source: '1:Filter Loss',
      target: '2:Filter Loss',
      value: 14,
      severity: 'low',
    });
    expect(payload.summary).toEqual([
      { label: 'Total Event Count', value: '54', caption: 'For 7 days', icon: 'list' },
      { label: 'Time range', value: '', caption: 'June 23 – June 29, 2026', icon: 'calendar' },
    ]);
  });

  it('leaves a two-stage flow to the two-column sankey', () => {
    const { rows, hints } = flowTable(
      'source,target,event_count\nPower Loss,Cable Loss,58\nInput Voltage,AC Main Low,62\n',
    );
    expect(
      workspaceWidgetPayload('flow-sankey-chart', 'flowSankeyChart', LINK_BINDS, rows, hints),
    ).toBeNull();
    expect(flowSankeyFits(rows, hints)).toBe(false);
  });

  it('refuses a cycle', () => {
    const { rows, hints } = flowTable(
      'source,target,event_count\nA,B,5\nB,C,4\nC,A,3\nC,D,2\n',
    );
    expect(
      workspaceWidgetPayload('flow-sankey-chart', 'flowSankeyChart', LINK_BINDS, rows, hints),
    ).toBeNull();
    expect(flowSankeyFits(rows, hints)).toBe(false);
  });
});
