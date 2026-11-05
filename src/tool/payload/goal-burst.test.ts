import { describe, expect, it } from 'vitest';

import { assetHealthOverviewPayload } from './asset-health-overview.js';
import { goalBurstFits, goalBurstPayload } from './goal-burst.js';

/** One goal as the goal burst reads it: the asset health payload plus each group's kind and answer times. */
const BURST = {
  name: 'Onboarding Velocity',
  resourceGroupTotal: 21,
  goal: { id: 'G-007', total: 842, working: 645, awaiting: 33, blocked: 94, failed: 27, progress: '41%', burn: 4.2, status: 'blocked' },
  categories: [
    {
      id: 'RG-SYS',
      name: 'SYSTEM',
      kind: 'System',
      latency: { p50: 0.24, p95: '700ms' },
      total: 9,
      healthy: 1246,
      hold: 'blocked',
      calls: 5400,
      traffic: { flowing: 0.62, blocked: 0.31, awaiting: 0.07 },
      bytes: 1200000,
      sharedWith: 3,
      problems: [{ name: 'crm-prod', why: 'writes need a credential grant', state: 'blocked', agents: 84, since: 14, rule: 'R-047' }],
    },
    { id: 'RG-APP', name: 'APP', type: 'app', total: 12, healthy: 8931, held: 0, calls: 3300, heldUp: '12%' },
  ],
};

/** The same goal as rows, one per resource group, as a CSV sends it. */
const ROWS = [
  { resource_group: 'SYSTEM', kind: 'system', agents: '842', blocked: '94', healthy: '1246', held: '94', calls: '5400', p50_ms: '240', p95_ms: '700', resource_group_total: '21' },
  { resource_group: 'APP', kind: 'app', agents: '', blocked: '', healthy: '8931', held: '0', calls: '3300', p50_ms: '', p95_ms: '', resource_group_total: '21' },
  { resource_group: 'MODEL', kind: 'model', agents: '', blocked: '', healthy: '40', held: '0', calls: '900', p50_ms: '900', p95_ms: '2100', resource_group_total: '21' },
];

describe('goal burst payload', () => {
  it('passes on the asset health payload with each group\'s kind, answer times, bytes and shared goals', () => {
    const out = goalBurstPayload({}, [BURST]) as Record<string, unknown>;
    expect(out.chartType).toBe('goalBurst');
    expect(out.name).toBe('Onboarding Velocity');
    expect(out.resourceGroupTotal).toBe(21);
    expect(out.goal).toEqual({ ...BURST.goal, name: 'Onboarding Velocity' });
    const [sys, app] = out.categories as Record<string, unknown>[];
    expect(sys).toEqual({ ...BURST.categories[0], kind: 'system' });
    expect(app).toEqual({ id: 'RG-APP', name: 'APP', kind: 'app', total: 12, healthy: 8931, held: 0, calls: 3300, heldUp: '12%' });
  });

  it('reads one row per resource group, with answer times in milliseconds where the column says so', () => {
    expect(goalBurstPayload({}, ROWS)).toEqual({
      chartType: 'goalBurst',
      goal: { total: 842, blocked: 94 },
      categories: [
        { name: 'SYSTEM', kind: 'system', healthy: 1246, held: 94, calls: 5400, latency: { p50: '240ms', p95: '700ms' } },
        { name: 'APP', kind: 'app', healthy: 8931, held: 0, calls: 3300 },
        { name: 'MODEL', kind: 'model', healthy: 40, held: 0, calls: 900, latency: { p50: '900ms', p95: '2100ms' } },
      ],
      resourceGroupTotal: 21,
    });
  });

  it('fits only when every group has its calls and some group its answer times', () => {
    expect(goalBurstFits(BURST)).toBe(true);
    expect(goalBurstFits([BURST])).toBe(true);
    expect(goalBurstFits(ROWS)).toBe(true);
    // Without answer times it is the asset health overview's reading, not the burst's.
    expect(goalBurstFits(ROWS.map(({ p50_ms, p95_ms, ...row }) => (void p50_ms, void p95_ms, row)))).toBe(false);
    // A group without its calls has no sector.
    expect(goalBurstFits(ROWS.map((row, i) => (i === 1 ? { ...row, calls: '' } : row)))).toBe(false);
    // Without the goal's agents it is not one goal's traffic.
    expect(goalBurstFits(ROWS.map((row) => ({ ...row, agents: '' })))).toBe(false);
    expect(goalBurstFits(null)).toBe(false);
  });

  it('leaves the asset health overview as it was', () => {
    const out = assetHealthOverviewPayload({}, [BURST]) as { categories: Record<string, unknown>[] };
    expect(out.categories[0]).not.toHaveProperty('latency');
    expect(out.categories[0]).not.toHaveProperty('kind');
  });

  it('returns null when the rows do not fit', () => {
    expect(goalBurstPayload({}, ROWS.slice(0, 1))).toBeNull();
  });
});
