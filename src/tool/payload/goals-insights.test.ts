import { describe, expect, it } from 'vitest';

import { namesInsights } from '../../profiler/insight-columns.js';
import { goalsInsightsFits, goalsInsightsPayload } from './goals-insights.js';
import { graphChart, isGraphChart } from './graph.js';

/** Claims filed under G-014, and two goals it shares evidence with, one row per claim. */
const CLAIMS = [
  { claim_id: 'INS-8822', goal: 'G-014', goal_name: 'Perimeter Watch', goal_status: 'On track', confidence: 0.81, priority: 'med', agents: 1108, claim: 'Firmware 4.2 cameras recover within 90 seconds', theme: 'camera coverage', type: 'Observation', polarity: 'Confirming', state: 'corroborated', sources: 6, records: 294, weight: 0.09, agent: 'AGT-1251 Picket', age: 60.5, asset: 'camera' },
  { claim_id: 'INS-8824', goal: 'G-022', goal_name: 'Maintain Verified Asset Visibility', goal_status: 'at_risk', confidence: '58%', priority: 'HIGH', agents: 612, claim: 'Decommissioned servers are still listed as live', theme: 'asset inventory', type: 'gap', polarity: 'contradicting', state: 'corroborated', sources: 3, records: 243, weight: 0.37, agent: 'AGT-0958 Census', age: 57.9, asset: 'store' },
  { claim_id: 'INS-8827', goal: 'G-014', claim: 'Gate 3 tailgating alerts down 40% week on week', theme: 'perimeter patrol', type: 'observation', polarity: 'confirming', sources: 5, age: '52.3h' },
  { claim_id: 'INS-8862', goal: 'G-014', claim: 'Badge event at C-114 overlaps a 47-minute camera outage', type: 'correlation', polarity: 'contradicting', sources: 4, age: 9.1, also: 'G-052' },
  { claim_id: 'INS-8863', goal: 'G-052', goal_name: 'Incident Response', claim: 'Badge event at C-114 opened an incident with no camera view', type: 'correlation', polarity: 'contradicting', sources: 3, age: 8.9, also: 'G-014' },
  { claim_id: 'INS-8885', goal: 'G-014', claim: 'Video triage lane p95 1.9s against a 1.2s threshold', type: 'hunch', polarity: 'contradicting', state: 'new', sources: 3, age: 0.6 },
];

describe('goals and insights payload', () => {
  it('draws the goal with the most claims, the goals it shares evidence with, and every claim', () => {
    const payload = goalsInsightsPayload({}, CLAIMS) as Record<string, unknown>;
    expect(payload.chartType).toBe('goalsInsights');
    expect(payload.goal).toEqual({
      id: 'G-014',
      name: 'Perimeter Watch',
      status: 'on track',
      confidence: 0.81,
      priority: 'MED',
      total: 1108,
    });
    expect(payload.connected).toEqual([
      { id: 'G-022', name: 'Maintain Verified Asset Visibility', status: 'at risk', confidence: '58%', priority: 'HIGH', total: 612 },
      { id: 'G-052', name: 'Incident Response' },
    ]);
    const claims = payload.claims as Record<string, unknown>[];
    expect(claims).toHaveLength(6);
    expect(claims[0]).toEqual({
      id: 'INS-8822',
      goal: 'G-014',
      claim: 'Firmware 4.2 cameras recover within 90 seconds',
      age: 60.5,
      theme: 'camera coverage',
      agent: 'AGT-1251 Picket',
      asset: 'camera',
      polarity: 'confirming',
      state: 'corroborated',
      type: 'observation',
      sources: 6,
      records: 294,
      weight: 0.09,
    });
    // An age in hours may say so, and a claim names the other goals it bears on.
    expect(claims[2]).toMatchObject({ id: 'INS-8827', age: 52.3 });
    expect(claims[3]).toMatchObject({ also: 'G-052' });
    // A type the widget does not draw is left out, and nothing unsent is invented.
    expect(claims[5]).toEqual({
      id: 'INS-8885',
      goal: 'G-014',
      claim: 'Video triage lane p95 1.9s against a 1.2s threshold',
      age: 0.6,
      polarity: 'contradicting',
      state: 'new',
      sources: 3,
    });
  });

  it('sends one goal alone when every claim was filed under it', () => {
    const rows = CLAIMS.map((row) => ({ ...row, goal: 'G-014', goal_name: 'Perimeter Watch' }));
    const payload = goalsInsightsPayload({}, rows) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('connected');
    expect(payload.goal).toMatchObject({ id: 'G-014', name: 'Perimeter Watch' });
  });

  it('names the column from a title column that is the same on every row', () => {
    const rows = CLAIMS.map((row) => ({ ...row, title: 'Perimeter evidence' }));
    expect(goalsInsightsPayload({}, rows)).toMatchObject({ title: 'Perimeter evidence' });
  });

  it('fits claims filed under a few goals, each with its age, and nothing else', () => {
    expect(goalsInsightsFits(CLAIMS)).toBe(true);
    // Too few claims to be a column of evidence.
    expect(goalsInsightsFits(CLAIMS.slice(0, 4))).toBe(false);
    // A claim without its age has no ring.
    expect(goalsInsightsFits(CLAIMS.map((row, i) => (i === 3 ? { ...row, age: '' } : row)))).toBe(false);
    // Nine goals is a comparison of goals, not the evidence behind one.
    const spread = Array.from({ length: 9 }, (_, i) => ({ ...CLAIMS[0]!, goal: `G-${i}` }));
    expect(goalsInsightsFits(spread)).toBe(false);
    // A free-form adjacency list.
    expect(goalsInsightsFits(Array.from({ length: 6 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` })))).toBe(false);
    expect(goalsInsightsFits(null)).toBe(false);
  });

  it('returns null when the rows do not fit', () => {
    expect(goalsInsightsPayload({}, CLAIMS.slice(0, 2))).toBeNull();
  });
});

describe('goals and insights columns', () => {
  it('shares its column vocabulary with the family gate', () => {
    expect(namesInsights(Object.keys(CLAIMS[0]!))).toBe(true);
    expect(namesInsights(['Insight', 'Goal Name', 'Hours ago'])).toBe(true);
    // Without the age, or without the claim, it is not evidence behind a goal.
    expect(namesInsights(['claim', 'goal'])).toBe(false);
    expect(namesInsights(['goal', 'age', 'sources'])).toBe(false);
  });
});

describe('graph family drawing with goals and insights', () => {
  it('picks goals and insights for claims filed under goals', () => {
    expect(graphChart(CLAIMS)).toBe('goals-insights');
  });

  it('keeps the network graph when the host cannot draw goals and insights', () => {
    expect(graphChart(CLAIMS, (id) => id !== 'goals-insights')).toBe('network-graph');
  });

  it('knows goals and insights as a graph drawing', () => {
    expect(isGraphChart('goals-insights')).toBe(true);
  });
});
