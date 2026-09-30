import { describe, expect, it } from 'vitest';

import { CHART_FAMILIES } from '../catalog/chart-roles.js';
import type { DataProfile } from '../spec/data-profile.js';
import { acceptReading, classChoiceRequest, markChoiceRequest, offeredChartIds } from './chart-choice.js';

const lineNotBar: DataProfile = {
  hasCategory: true,
  hasNumericMetric: true,
  hasTemporal: true,
  categoryCardinality: 4,
  rowCount: 24,
};

const mapOnly: DataProfile = {
  hasGeo: true,
  hasNumericMetric: true,
  hasMapToken: true,
  hasCategory: false,
  categoryCardinality: 0,
  rowCount: 40,
};

describe('classChoiceRequest', () => {
  it('offers one main per family, not the near-duplicate marks', () => {
    const request = classChoiceRequest({
      utterance: 'Compare incident counts by team over months, as a line, not a bar.',
      columns: [
        { name: 'team', role: 'category' },
        { name: 'month', role: 'temporal' },
        { name: 'incidents', role: 'metric' },
      ],
      profile: lineNotBar,
      intent: 'comparison',
      askNamedChart: true,
    });
    const offered = offeredChartIds(request);
    expect(offered).toContain('line-chart');
    expect(offered).toContain('bar-chart');
    expect(offered).toContain('pie-chart');
    expect(offered).not.toContain('lollipop');
    expect(offered).not.toContain('map-chart');
    expect(request.questions).not.toHaveProperty('intent');
    expect(request.questions.named_chart?.type).toBe('noul');
    expect(request.state.intent).toBe('comparison');
    expect(request.state.categoryCardinality).toBe(4);
    expect(request.state.rowCount).toBe(24);
    expect(request.state).not.toHaveProperty('rows');
  });

  it('offers the scatter class, not the bubble redraw', () => {
    const request = classChoiceRequest({
      utterance: 'How do height and weight relate?',
      columns: [
        { name: 'height', role: 'metric' },
        { name: 'weight', role: 'metric' },
      ],
      profile: {
        hasNumericMetric: true,
        hasCategory: false,
        categoryCardinality: 0,
        rowCount: 20,
      },
      intent: 'comparison',
      askNamedChart: false,
    });
    const offered = offeredChartIds(request);
    expect(offered).toContain('scatter-plot-chart');
    expect(offered).not.toContain('bubble-chart');
    expect(offered).not.toContain('matrix-chart');
    expect(request.questions.named_chart).toBeUndefined();
  });

  it('offers the map when the columns are geographic', () => {
    const request = classChoiceRequest({
      utterance: 'Show incidents on a map by country.',
      columns: [
        { name: 'country', role: 'geo' },
        { name: 'incidents', role: 'metric' },
      ],
      profile: mapOnly,
      intent: 'spatial',
      askNamedChart: true,
    });
    expect(offeredChartIds(request)).toContain('map-chart');
    expect(offeredChartIds(request)).not.toContain('bar-chart');
  });

  it('asks Jev only inside the chosen class', () => {
    const family = CHART_FAMILIES.find((item) => item.id === 'category-magnitude');
    if (!family) throw new Error('missing family');
    const request = markChoiceRequest({
      utterance: 'Compare teams.',
      columns: [
        { name: 'team', role: 'category' },
        { name: 'score', role: 'metric' },
      ],
      profile: lineNotBar,
      intent: 'comparison',
      family,
    });
    const offered = offeredChartIds(request);
    expect(offered).toContain('bar-chart');
    expect(offered).toContain('lollipop');
    expect(offered).not.toContain('map-chart');
    expect(request.questions.chart.criteria.lollipop).toContain('stem');
  });

  it('accepts a clear offered chart and rejects a thin or foreign one', () => {
    const allowed = ['line-chart', 'bar-chart'];
    expect(
      acceptReading(
        {
          answers: {
            chart: {
              type: 'choice',
              choice: 'line-chart',
              confidence: 0.8,
              probabilities: { 'line-chart': 0.8, 'bar-chart': 0.2 },
            },
            named_chart: { type: 'noul', noul: 0.9 },
          },
        },
        allowed,
      ),
    ).toMatchObject({ top: 'line-chart', clear: true, namedChart: true, runnerUp: 'bar-chart' });

    expect(
      acceptReading(
        {
          answers: {
            chart: {
              type: 'choice',
              choice: 'line-chart',
              confidence: 0.51,
              probabilities: { 'line-chart': 0.51, 'bar-chart': 0.49 },
            },
          },
        },
        allowed,
      ).clear,
    ).toBe(false);

    expect(
      acceptReading(
        { answers: { chart: { type: 'choice', choice: 'map-chart', confidence: 0.99 } } },
        allowed,
      ).top,
    ).toBeNull();

    expect(
      acceptReading(
        { answers: { chart: { type: 'choice', choice: 'line-chart', confidence: 0.2 } } },
        allowed,
      ).clear,
    ).toBe(false);
  });
});
