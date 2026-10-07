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

  it('calls the dial when a metric beside the health score has no status', () => {
    expect(headlineChart([...POWER_PATH, { metric: 'Current Draw', value: 18.7, unit: 'A' }])).toBe(
      'status-gauge-widget',
    );
  });

  it('keeps a KPI for a plain number or for several metrics', () => {
    expect(headlineChart([{ loss: 24.3 }])).toBe('kpi-widget');
    expect(headlineChart([{ loss: 24.3, noise: 1, min: 0, max: 30, okTo: 10 }])).toBe('kpi-widget');
  });
});
