import { describe, expect, it } from 'vitest';

import type { EngineCatalog } from '../spec/engine-catalog.js';
import type { DataProfile } from '../spec/data-profile.js';
import { INTENTS } from '../spec/intent.js';
import { decide } from './decide.js';

/** Same shape as the Stage 2 beachhead metadata — fixture, not a catalog import. */
const catalog: EngineCatalog = [
  {
    id: 'map-chart',
    intents: ['spatial'],
    allowedActions: ['hover', 'pan', 'zoom', 'resize'],
    eligibility: [
      {
        when: 'profile.hasGeo && profile.hasMapToken',
        reason: 'Map is eligible when the profile is spatial and a token is available.',
      },
    ],
    disqualify: [
      { when: '!profile.hasGeo', reason: 'Without geo fields the map has nothing to join.' },
    ],
    evalCases: [
      {
        id: 'map-picks-geo',
        intent: 'spatial',
        profile: { hasGeo: true, hasMapToken: true },
        expect: 'eligible',
        reasonIncludes: 'spatial',
      },
    ],
  },
  {
    id: 'bar-chart',
    intents: ['comparison'],
    allowedActions: ['hover', 'resize'],
    eligibility: [
      {
        when: 'profile.hasCategory && profile.hasNumericMetric && profile.categoryCardinality <= 30',
        reason: 'Bar compares a handful of discrete groups on one metric.',
      },
    ],
    disqualify: [
      {
        when: 'profile.hasGeo && !profile.hasCategory',
        reason: 'Spatial-only data belongs on map-chart, not bars.',
      },
    ],
    evalCases: [
      {
        id: 'bar-picks-groups',
        intent: 'comparison',
        profile: { hasCategory: true, hasNumericMetric: true, categoryCardinality: 5 },
        expect: 'eligible',
        reasonIncludes: 'discrete groups',
      },
    ],
  },
  {
    id: 'histogram-chart',
    intents: ['comparison'],
    allowedActions: ['hover', 'resize'],
    eligibility: [
      {
        when: 'profile.hasNumericMetric && profile.rowCount >= 8',
        reason: 'Histogram shows the shape of a numeric distribution.',
      },
    ],
    disqualify: [],
    evalCases: [],
  },
  {
    id: 'kpi-widget',
    intents: ['summary'],
    allowedActions: ['resize'],
    eligibility: [
      {
        when: 'profile.hasNumericMetric && profile.categoryCardinality <= 12',
        reason: 'KPI summarises a small set of numeric headlines.',
      },
    ],
    disqualify: [],
    evalCases: [
      {
        id: 'kpi-picks',
        intent: 'summary',
        profile: { hasNumericMetric: true, categoryCardinality: 5 },
        expect: 'eligible',
        reasonIncludes: 'headlines',
      },
    ],
  },
  {
    id: 'form',
    intents: ['form'],
    allowedActions: ['submit'],
    eligibility: [
      {
        when: 'profile.allControlsLabelled && profile.controlCount >= 1',
        reason: 'Form collects labelled fields.',
      },
    ],
    disqualify: [
      { when: '!profile.allControlsLabelled', reason: 'Unlabelled control is refused.' },
    ],
    evalCases: [
      {
        id: 'form-picks',
        intent: 'form',
        profile: { allControlsLabelled: true, controlCount: 2 },
        expect: 'eligible',
        reasonIncludes: 'labelled',
      },
    ],
  },
  {
    id: 'text-input',
    intents: ['form'],
    allowedActions: ['resize'],
    eligibility: [
      {
        when: 'profile.allControlsLabelled && profile.controlCount >= 1',
        reason: 'Form controls are eligible when every control has a label.',
      },
    ],
    disqualify: [],
  },
];

const profile: DataProfile = {
  hasCategory: true,
  hasNumericMetric: true,
  categoryCardinality: 5,
  hasGeo: true,
  hasMapToken: true,
  allControlsLabelled: true,
  controlCount: 2,
  rowCount: 3,
};

describe('decide', () => {
  it('picks distinct winners for four intents on one profile', () => {
    const spatial = decide({ intent: 'spatial', profile, catalog });
    const comparison = decide({ intent: 'comparison', profile, catalog });
    const summary = decide({ intent: 'summary', profile, catalog });
    const form = decide({ intent: 'form', profile, catalog });

    expect(spatial.winner).toBe('map-chart');
    expect(comparison.winner).toBe('bar-chart');
    expect(summary.winner).toBe('kpi-widget');
    expect(form.winner).toBe('form');

    const winners = [spatial.winner, comparison.winner, summary.winner, form.winner];
    expect(new Set(winners).size).toBe(4);
  });

  it('rejects with a sentence, not an empty code', () => {
    const decision = decide({ intent: 'spatial', profile, catalog });
    expect(decision.rejected.length).toBeGreaterThan(0);
    for (const item of decision.rejected) {
      expect(item.reason.length).toBeGreaterThan(8);
      expect(item.reason.includes(' ')).toBe(true);
    }
  });

  it('does not hardcode intent to a component id', () => {
    const flipped: EngineCatalog = catalog.map((entry) =>
      entry.id === 'kpi-widget'
        ? { ...entry, intents: ['spatial'] }
        : entry.id === 'map-chart'
          ? { ...entry, intents: ['summary'] }
          : entry,
    );
    expect(decide({ intent: 'spatial', profile, catalog: flipped }).winner).toBe('kpi-widget');
  });

  it('emits a JSON-serializable trace without rows on every call', () => {
    for (const intent of ['spatial', 'comparison', 'summary', 'form'] as const) {
      const { trace } = decide({ intent, profile, catalog });
      expect(trace.objective).toBe(intent);
      expect(trace.profile).toEqual(profile);
      expect(trace.candidates.length + trace.rejections.length).toBeGreaterThan(0);
      expect(typeof trace.tieBreak).toBe('string');
      expect(trace.tieBreak.length).toBeGreaterThan(0);
      expect('rows' in trace.profile).toBe(false);
      expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
    }
  });

  it('keeps catalog-only actions off the trace', () => {
    const { trace } = decide({ intent: 'spatial', profile, catalog });
    expect(trace.actions).toEqual(['hover', 'resize']);
    expect(trace.actions).not.toContain('pan');
  });

  it('rejects an intents-only entry with no eligibility rule', () => {
    const slim: EngineCatalog = [
      { id: 'pie-chart', intents: ['comparison'] },
      catalog.find((entry) => entry.id === 'bar-chart')!,
    ];
    const decision = decide({ intent: 'comparison', profile, catalog: slim });
    expect(decision.winner).toBe('bar-chart');
    expect(decision.rejected).toContainEqual({
      id: 'pie-chart',
      reason: 'No eligibility rule matched the profile.',
    });
  });

  it('boosts only evalCases whose profile matches the input', () => {
    const eligibility = [
      {
        when: 'profile.hasNumericMetric && profile.categoryCardinality <= 12',
        reason: 'KPI summarises a small set of numeric headlines.',
      },
    ];
    const scored: EngineCatalog = [
      {
        id: 'alpha',
        intents: ['summary'],
        eligibility,
        evalCases: [
          {
            id: 'wrong-profile',
            intent: 'summary',
            profile: { hasNumericMetric: false },
            expect: 'eligible',
            reasonIncludes: 'must not apply',
          },
        ],
      },
      {
        id: 'beta',
        intents: ['summary'],
        eligibility,
        evalCases: [
          {
            id: 'right-profile',
            intent: 'summary',
            profile: { hasNumericMetric: true, categoryCardinality: 5 },
            expect: 'eligible',
            reasonIncludes: 'headlines',
          },
        ],
      },
    ];
    const decision = decide({ intent: 'summary', profile, catalog: scored });
    const alpha = decision.eligible.find((item) => item.id === 'alpha');
    const beta = decision.eligible.find((item) => item.id === 'beta');
    expect(decision.winner).toBe('beta');
    expect(alpha).toEqual({ id: 'alpha', score: 12, reasons: expect.any(Array) });
    expect(beta).toEqual({ id: 'beta', score: 15, reasons: expect.any(Array) });
  });

  it('rejects an eligibility match that declares no intents', () => {
    const slim: EngineCatalog = [
      {
        id: 'orphan-kpi',
        eligibility: [
          {
            when: 'profile.hasNumericMetric',
            reason: 'KPI summarises a numeric headline.',
          },
        ],
      },
      catalog.find((entry) => entry.id === 'kpi-widget')!,
    ];
    const decision = decide({ intent: 'summary', profile, catalog: slim });
    expect(decision.winner).toBe('kpi-widget');
    expect(decision.rejected).toContainEqual({
      id: 'orphan-kpi',
      reason: 'Component intents do not include this objective.',
    });
  });

  it('does not invent intents', () => {
    expect([...INTENTS]).toEqual([
      'spatial',
      'comparison',
      'summary',
      'form',
      'evidence',
      'graph',
    ]);
  });
});
