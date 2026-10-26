import { describe, expect, it } from 'vitest';

import { headlineChart } from './headline.js';

describe('headlineChart', () => {
  it('calls the loss indicator for one metric that already has a scale and thresholds', () => {
    expect(
      headlineChart([
        { label: 'Electrical Loss', value: 24.3, unit: '%', min: 0, max: 30, okTo: 10, warningTo: 20 },
      ]),
    ).toBe('loss-indicator');
  });

  it('calls the dial when a health score sits beside other measures', () => {
    expect(headlineChart([{ unitHealth: 72.8, txPower: 28, min: 0, max: 100, okTo: 80 }])).toBe(
      'status-gauge-widget',
    );
  });

  it('calls the loss indicator when the only numbers beside a health score are its scale', () => {
    expect(headlineChart([{ unitHealth: 72.8, min: 0, max: 100, okTo: 80 }])).toBe('loss-indicator');
  });

  const POWER_PATH = [
    { metric: 'Electricity Health', value: 69.9, unit: '%' },
    { metric: 'Input Voltage', value: 48.1, unit: 'V', status: 'Stable' },
    { metric: 'Output Voltage', value: 36.4, unit: 'V', status: 'Critical' },
  ];

  it('calls the power path card when a health score sits beside metrics that each have a status', () => {
    expect(headlineChart(POWER_PATH)).toBe('power-path-card');
  });

  it('calls the dial when the power path card cannot be drawn', () => {
    expect(headlineChart(POWER_PATH, (id) => id !== 'power-path-card')).toBe('status-gauge-widget');
  });

  it('keeps a KPI when neither the power path card nor the dial can be drawn', () => {
    expect(headlineChart(POWER_PATH, (id) => id === 'kpi-widget')).toBe('kpi-widget');
  });

  it('keeps a KPI when the loss indicator cannot be drawn', () => {
    const scaled = [
      { label: 'Electrical Loss', value: 24.3, unit: '%', min: 0, max: 30, okTo: 10, warningTo: 20 },
    ];
    expect(headlineChart(scaled, (id) => id !== 'loss-indicator')).toBe('kpi-widget');
  });

  it('calls the dial when a metric beside the health score has no status', () => {
    expect(headlineChart([...POWER_PATH, { metric: 'Current Draw', value: 18.7, unit: 'A' }])).toBe(
      'status-gauge-widget',
    );
  });

  it('calls the component asset card for one asset named by its id with one metric', () => {
    expect(
      headlineChart([{ name: 'Sector A1 Antenna', asset_id: 'RTX-3090', metric: 'Packet loss', value: 1.02 }]),
    ).toBe('component-asset-card');
    expect(headlineChart([{ device: 'RTX-3090', packet_loss: 1.02 }])).toBe('component-asset-card');
  });

  it('keeps a KPI when the component asset card cannot be drawn', () => {
    const asset = [{ asset_id: 'RTX-3090', metric: 'Packet loss', value: 1.02 }];
    expect(headlineChart(asset, (id) => id !== 'component-asset-card')).toBe('kpi-widget');
  });

  it('calls the loss indicator over the asset card when the metric already has a scale', () => {
    expect(
      headlineChart([{ asset_id: 'RTX-3090', label: 'Packet loss', value: 1.02, min: 0, max: 5, okTo: 2 }]),
    ).toBe('loss-indicator');
  });

  it('calls the power path card, not the asset card, for one asset with a health score and metrics behind it', () => {
    expect(headlineChart(POWER_PATH.map((row) => ({ asset_id: 'RTX-3090', ...row })))).toBe('power-path-card');
  });

  it('calls the incidents review card for incident counts by state', () => {
    expect(headlineChart([{ openIncidents: 12, acknowledgedIncidents: 5, resolvedIncidents: 30 }])).toBe(
      'incidents-review-card',
    );
  });

  it('keeps a KPI when the incidents review card cannot be drawn', () => {
    const incidents = [{ openIncidents: 12, acknowledgedIncidents: 5, resolvedIncidents: 30 }];
    expect(headlineChart(incidents, (id) => id !== 'incidents-review-card')).toBe('kpi-widget');
  });

  const ASSET_HEALTH = {
    agents: { total: 1204, awaiting: 19, blocked: 84, failed: 2 },
    categories: [
      { name: 'Applications', total: 12, healthy: 12, degraded: 0, failing: 0 },
      { name: 'Databases', total: 9, healthy: 8, degraded: 0, failing: 1 },
    ],
  };

  it('calls the asset health overview for an agent population plus category health', () => {
    expect(headlineChart(ASSET_HEALTH)).toBe('asset-health-overview');
  });

  it('calls the asset health overview for one named WidgetItem row', () => {
    expect(
      headlineChart([
        {
          name: 'Onboarding Velocity',
          goal: { id: 'G-007', name: 'Onboarding Velocity', total: 1204 },
          categories: ASSET_HEALTH.categories,
        },
      ]),
    ).toBe('asset-health-overview');
  });

  it('keeps a KPI when the asset health overview cannot be drawn', () => {
    expect(headlineChart(ASSET_HEALTH, (id) => id !== 'asset-health-overview')).toBe('kpi-widget');
  });

  it('keeps the dial for a health score beside other measures, not the asset health overview', () => {
    expect(headlineChart([{ unitHealth: 72.8, txPower: 28, min: 0, max: 100, okTo: 80 }])).toBe(
      'status-gauge-widget',
    );
  });

  it('keeps a KPI for a plain number or for several metrics', () => {
    expect(headlineChart([{ loss: 24.3 }])).toBe('kpi-widget');
    expect(headlineChart([{ loss: 24.3, noise: 1, min: 0, max: 30, okTo: 10 }])).toBe('kpi-widget');
    expect(headlineChart([{ id: 1, packet_loss: 1.02 }])).toBe('kpi-widget');
    expect(headlineChart([{ asset_id: 'RTX-3090', packet_loss: 1.02, latency: 14 }])).toBe('kpi-widget');
  });
});
