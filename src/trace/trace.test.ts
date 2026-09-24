import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { decide } from '../engine/decide.js';
import type { EngineCatalog } from '../spec/engine-catalog.js';
import {
  TRACE_OUTCOMES,
  TRACE_RISK_BANDS,
  assertTraceHasNoRows,
  closedProfile,
  stage4TraceDefaults,
  type Trace,
} from './trace.js';

const TRACE_V2 = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/inspector/trace.v2.json', import.meta.url), 'utf8'),
) as Trace;

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
    expect(trace.risk).toEqual([{ action: 'resize', band: 'low' }]);
    expect(trace.proposal).toBeNull();
    expect(trace.outcome).toBe('rendered');
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

  it('refuses rows smuggled onto a proposal', () => {
    const doctored = {
      ...TRACE_V2,
      proposal: { ...TRACE_V2.proposal, rows: [{ secret: 1 }] },
    } as unknown as Trace;
    expect(() => assertTraceHasNoRows(doctored)).toThrow('trace must not contain rows');
  });
});

describe('trace v2 fixture', () => {
  const stage3Keys = ['objective', 'profile', 'candidates', 'rejections', 'actions', 'tieBreak'] as const;

  it('keeps the stage 3 record and adds risk, proposal, and outcome', () => {
    for (const key of stage3Keys) {
      expect(TRACE_V2[key], key).toBeDefined();
    }
    expect(TRACE_V2.objective).toBe('form');
    expect(TRACE_V2.candidates[0]?.id).toBe('approval-bar');
    expect(TRACE_V2.actions).toEqual(['approve', 'reject']);
    expect(TRACE_V2.tieBreak).toBe('highest score 12 (approval-bar)');
  });

  it('lists one risk entry per action, with a closed band', () => {
    expect(TRACE_V2.risk.map((item) => item.action)).toEqual(TRACE_V2.actions);
    for (const item of TRACE_V2.risk) {
      expect(TRACE_RISK_BANDS).toContain(item.band);
    }
    expect(TRACE_V2.risk.every((item) => item.band === 'held')).toBe(true);
  });

  it('carries a preview proposal and a held outcome the inspector can render', () => {
    expect(TRACE_V2.proposal).toEqual({
      id: 'proposal:approve',
      action: 'approve',
      preview: 'Preview approve on approval-bar. This record is not an execution.',
    });
    expect(TRACE_V2.proposal).toEqual(TRACE_V2.proposals[0]);
    expect(TRACE_V2.proposals.map((item) => item.action)).toEqual(['approve', 'reject']);
    expect(TRACE_V2.outcome).toBe('held');
    assertTraceHasNoRows(TRACE_V2);
    expect(JSON.parse(JSON.stringify(TRACE_V2))).toEqual(TRACE_V2);
  });

  it('still accepts a trace whose proposal is null', () => {
    const rendered: Trace = {
      ...TRACE_V2,
      proposal: null,
      proposals: [],
      outcome: 'rendered',
      risk: [],
    };
    expect(rendered.proposal).toBeNull();
    expect(rendered.outcome).toBe('rendered');
    expect(stage4TraceDefaults()).toEqual({
      risk: [],
      proposals: [],
      proposal: null,
      outcome: 'rendered',
    });
    assertTraceHasNoRows(rendered);
  });
});
