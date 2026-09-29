import { describe, expect, it } from 'vitest';

import type { DataProfile } from '../spec/data-profile.js';
import { discussChart, resolveChartName } from './discuss-chart.js';

const catalogIds = new Set(['bar-chart', 'map-chart', 'histogram-chart', 'kpi-widget', 'line-chart']);

const groups: DataProfile = {
  hasCategory: true,
  hasNumericMetric: true,
  categoryCardinality: 5,
  rowCount: 5,
  hasMapToken: true,
};

describe('discussChart', () => {
  it('resolves short names and chartType keys', () => {
    expect(resolveChartName('pie')).toBe('pie-chart');
    expect(resolveChartName('bar chart')).toBe('bar-chart');
    expect(resolveChartName('pieChart')).toBe('pie-chart');
    expect(resolveChartName('not-a-chart')).toBeUndefined();
  });

  it('proposes the comparison main and does not draw an unfit chart', () => {
    const discussion = discussChart({
      profile: groups,
      requestedChart: 'pie',
      confirm: false,
      intent: 'comparison',
      catalogIds,
    });
    expect(discussion.awaitingUser).toBe(true);
    expect(discussion.drawId).toBeUndefined();
    expect(discussion.proposedChart).toBe('bar-chart');
    expect(discussion.dataFamilies).toContain('category-magnitude');
    expect(discussion.message).toContain('does not fit');
  });

  it('draws a requested main that the catalog can render', () => {
    const discussion = discussChart({
      profile: groups,
      requestedChart: 'bar-chart',
      confirm: false,
      intent: 'summary',
      catalogIds,
    });
    expect(discussion.awaitingUser).toBe(false);
    expect(discussion.drawId).toBe('bar-chart');
    expect(discussion.chartWhy).toContain('discrete groups');
  });

  it('keeps a line when it is in the comparison group', () => {
    const discussion = discussChart({
      profile: groups,
      requestedChart: 'line',
      confirm: false,
      intent: 'comparison',
      catalogIds,
    });
    expect(discussion.awaitingUser).toBe(false);
    expect(discussion.drawId).toBe('line-chart');
    expect(discussion.proposedChart).toBe('line-chart');
    expect(discussion.proposedChart).not.toBe('bar-chart');
  });

  it('does not offer a retry when the in-group chart cannot be drawn', () => {
    const discussion = discussChart({
      profile: groups,
      requestedChart: 'line',
      confirm: true,
      intent: 'comparison',
      catalogIds: new Set(['bar-chart', 'map-chart', 'kpi-widget']),
    });
    expect(discussion.awaitingUser).toBe(true);
    expect(discussion.drawId).toBeUndefined();
    expect(discussion.proposedChart).toBeUndefined();
    expect(discussion.message).toContain('stays line-chart');
    expect(discussion.message).toContain('Do not call again');
  });
});
