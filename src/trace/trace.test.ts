import { describe, expect, it } from 'vitest';

import { decide } from '../engine/decide.js';
import type { EngineCatalog } from '../spec/engine-catalog.js';
import { assertTraceHasNoRows, closedProfile, type Trace } from './trace.js';

const catalog: EngineCatalog = [
  {
    id: 'kpi-widget',
    intents: ['summary'],
    allowedActions: ['resize'],
    eligibility: [
      {
        when: 'profile.hasNumericMetric',
        reason: 'KPI summarises a numeric headline.',
      },
    ],
  },
];

describe('Trace', () => {
  it('round-trips through JSON and never carries rows', () => {
    const dirty = {
      hasNumericMetric: true,
      rows: [{ secret: 1 }],
    } as Parameters<typeof decide>[0]['profile'];

    const { trace } = decide({ intent: 'summary', profile: dirty, catalog });
    expect(closedProfile(dirty)).toEqual({ hasNumericMetric: true });
    expect(trace.profile).toEqual({ hasNumericMetric: true });
    expect('rows' in trace.profile).toBe(false);
    assertTraceHasNoRows(trace);
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
    expect(trace.objective).toBe('summary');
    expect(trace.candidates[0]?.id).toBe('kpi-widget');
  });

  it('fails when rows are smuggled onto a candidate', () => {
    const { trace } = decide({
      intent: 'summary',
      profile: { hasNumericMetric: true },
      catalog,
    });
    const smuggled = {
      ...trace,
      candidates: [{ ...trace.candidates[0], rows: [{ secret: 1 }] }],
    } as unknown as Trace;
    expect(() => assertTraceHasNoRows(smuggled)).toThrow('trace must not contain rows');
  });
});
