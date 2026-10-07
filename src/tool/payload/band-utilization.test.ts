import { describe, expect, it } from 'vitest';

import { bandUtilizationFits, isPartToWholeChart, partToWholeChart } from './band-utilization.js';

const shares = [
  { sector: 'A1', band: 'Low', share: 22 },
  { sector: 'A1', band: 'Medium', share: 48 },
  { sector: 'A1', band: 'High', share: 30 },
  { sector: 'B1', band: 'Low', share: 18 },
  { sector: 'B1', band: 'Medium', share: 52 },
  { sector: 'B1', band: 'High', share: 30 },
];

describe('isPartToWholeChart', () => {
  it('follows the part-to-whole family, including later alternatives', () => {
    expect(isPartToWholeChart('pie-chart')).toBe(true);
    expect(isPartToWholeChart('donut-chart')).toBe(true);
    expect(isPartToWholeChart('treemap-chart')).toBe(true);
    expect(isPartToWholeChart('band-utilization-chart')).toBe(true);
    expect(isPartToWholeChart('bar-chart')).toBe(false);
  });
});

describe('partToWholeChart', () => {
  it('calls the band when the same shares repeat once per entity', () => {
    expect(bandUtilizationFits(shares)).toBe(true);
    expect(partToWholeChart(shares)).toBe('band-utilization-chart');
  });

  it('keeps a pie when one category is the slices of a single total', () => {
    const slices = [
      { team: 'Alpha', score: 10 },
      { team: 'Beta', score: 4 },
      { team: 'Gamma', score: 6 },
    ];
    expect(bandUtilizationFits(slices)).toBe(false);
    expect(partToWholeChart(slices)).toBe('pie-chart');
  });

  it('keeps a pie when the parts do not sum to a whole', () => {
    expect(
      partToWholeChart([
        { sector: 'A1', band: 'Low', share: 40 },
        { sector: 'A1', band: 'Medium', share: 25 },
        { sector: 'A1', band: 'High', share: 10 },
        { sector: 'B1', band: 'Low', share: 20 },
        { sector: 'B1', band: 'Medium', share: 20 },
        { sector: 'B1', band: 'High', share: 20 },
      ]),
    ).toBe('pie-chart');
  });
});
