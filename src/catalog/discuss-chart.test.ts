import { describe, expect, it } from 'vitest';

import type { DataProfile } from '../spec/data-profile.js';
import { discussChart, requestedChartFromUtterance, resolveChartName, utteranceNamesChart } from './discuss-chart.js';

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

  it('names a chart only when the words contain that chart', () => {
    const research =
      'Do a research on Fairfax county real estate situation for last 3 months and create a list widgets to explain the demand, supply and prices, location best';
    expect(utteranceNamesChart(research, 'bar-chart')).toBe(false);
    expect(utteranceNamesChart('Show teams as a bar.', 'bar')).toBe(true);
    expect(utteranceNamesChart('Show a bar chart of sales.', 'bar-chart')).toBe(true);
    expect(utteranceNamesChart('Show a map.', 'map')).toBe(true);
    expect(utteranceNamesChart('Show the map.', 'map')).toBe(true);
    expect(utteranceNamesChart('Show the line.', 'line')).toBe(true);
    expect(utteranceNamesChart('Compare the bargain listings.', 'bar')).toBe(false);
    expect(utteranceNamesChart('Prices in the area for last quarter.', 'area-chart')).toBe(false);
    expect(requestedChartFromUtterance(research, 'bar-chart')).toBeUndefined();
    expect(requestedChartFromUtterance(undefined, 'bar-chart')).toBe('bar-chart');
    expect(requestedChartFromUtterance('Show a sankey.', 'not-a-chart')).toBe('not-a-chart');
    expect(requestedChartFromUtterance(research, 'line-chart', { followUp: true })).toBe('line-chart');
  });

  it('draws a pie when the share family matches and the catalog can render it', () => {
    const discussion = discussChart({
      profile: groups,
      requestedChart: 'pie',
      intent: 'comparison',
      catalogIds: new Set([...catalogIds, 'pie-chart']),
    });
    expect(discussion.awaitingUser).toBe(false);
    expect(discussion.drawId).toBe('pie-chart');
    expect(discussion.dataFamilies).toContain('part-to-whole');
  });

  it('suggests the comparison main and does not substitute a chart it cannot draw', () => {
    const discussion = discussChart({
      profile: groups,
      requestedChart: 'sankey',
      intent: 'comparison',
      catalogIds,
    });
    expect(discussion.awaitingUser).toBe(true);
    expect(discussion.drawId).toBeUndefined();
    expect(discussion.suggestion).toBe('bar-chart');
    expect(discussion.dataFamilies).toContain('category-magnitude');
    expect(discussion.message).toContain('nothing was generated');
    expect(discussion.message).toContain('suggestion only');
  });

  it('draws an unfit chart the catalog can render and only suggests the closer one', () => {
    const discussion = discussChart({
      profile: groups,
      requestedChart: 'sankey',
      intent: 'comparison',
      catalogIds: new Set([...catalogIds, 'sankey-chart']),
    });
    expect(discussion.awaitingUser).toBe(false);
    expect(discussion.drawId).toBe('sankey-chart');
    expect(discussion.suggestion).toBe('bar-chart');
    expect(discussion.chartWhy).toContain('Drawing it');
    expect(discussion.chartWhy).toContain('stays sankey-chart');
    expect(discussion.poorFit).toBe(true);
  });

  it('draws a requested main that the catalog can render', () => {
    const discussion = discussChart({
      profile: groups,
      requestedChart: 'bar-chart',
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
      intent: 'comparison',
      catalogIds,
    });
    expect(discussion.awaitingUser).toBe(false);
    expect(discussion.drawId).toBe('line-chart');
    expect(discussion.suggestion).toBeUndefined();
  });

  it('does not offer a retry when the in-group chart cannot be drawn', () => {
    const discussion = discussChart({
      profile: groups,
      requestedChart: 'line',
      intent: 'comparison',
      catalogIds: new Set(['bar-chart', 'map-chart', 'kpi-widget']),
    });
    expect(discussion.awaitingUser).toBe(true);
    expect(discussion.drawId).toBeUndefined();
    expect(discussion.suggestion).toBeUndefined();
    expect(discussion.keepRequested).toBe(true);
    expect(discussion.message).toContain('stays line-chart');
    expect(discussion.message).toContain('How do discrete groups compare');
    expect(discussion.message).not.toContain('category-magnitude');
    expect(discussion.message).toContain('Do not call again');
  });
});
