import { describe, expect, it } from 'vitest';

import type { DataProfile } from '../spec/data-profile.js';
import { acceptChartChoice, chartChoiceRequest, offeredChartIds } from './chart-choice.js';

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

describe('chartChoiceRequest', () => {
  it('offers line and bar for a comparison the user wants drawn as a line', () => {
    const request = chartChoiceRequest({
      utterance: 'Compare incident counts by team over months, as a line, not a bar.',
      columns: [
        { name: 'team', role: 'category' },
        { name: 'month', role: 'temporal' },
        { name: 'incidents', role: 'metric' },
      ],
      profile: lineNotBar,
    });
    const offered = offeredChartIds(request);
    expect(offered).toContain('line-chart');
    expect(offered).toContain('bar-chart');
    expect(offered).toContain('pie-chart');
    expect(offered).not.toContain('map-chart');
    expect(request.questions.intent.criteria).toHaveProperty('comparison');
    expect(request.state).not.toHaveProperty('rows');
    expect(request.state.columns.map((column) => column.name)).toEqual(['team', 'month', 'incidents']);
  });

  it('offers scatter when the columns hold two metrics', () => {
    const request = chartChoiceRequest({
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
    });
    const offered = offeredChartIds(request);
    expect(offered).toContain('scatter-plot-chart');
    expect(offered).toContain('bubble-chart');
    expect(offered).not.toContain('matrix-chart');
    expect(offered).not.toContain('radar-chart');
  });

  it('offers the map when the columns are geographic', () => {
    const request = chartChoiceRequest({
      utterance: 'Show incidents on a map by country.',
      columns: [
        { name: 'country', role: 'geo' },
        { name: 'incidents', role: 'metric' },
      ],
      profile: mapOnly,
    });
    expect(offeredChartIds(request)).toContain('map-chart');
    expect(offeredChartIds(request)).not.toContain('bar-chart');
  });

  it('accepts only an offered chart above the confidence gate', () => {
    const request = chartChoiceRequest({
      utterance: 'Draw a line.',
      columns: [{ name: 'month', role: 'temporal' }],
      profile: lineNotBar,
    });
    const allowed = offeredChartIds(request);
    expect(
      acceptChartChoice(
        {
          answers: {
            intent: { type: 'choice', choice: 'comparison' },
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
    ).toMatchObject({ chart: 'line-chart', intent: 'comparison', namedChart: true });

    expect(
      acceptChartChoice(
        {
          answers: {
            chart: { type: 'choice', choice: 'map-chart', confidence: 0.99 },
          },
        },
        allowed,
      ).chart,
    ).toBeNull();

    expect(
      acceptChartChoice(
        {
          answers: {
            chart: { type: 'choice', choice: 'line-chart', confidence: 0.2 },
          },
        },
        allowed,
      ).chart,
    ).toBeNull();
  });
});
