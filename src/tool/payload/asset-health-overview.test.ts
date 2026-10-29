import { describe, expect, it } from 'vitest';

import { assetHealthFits, assetHealthOverviewPayload } from './asset-health-overview.js';

const OVERVIEW = {
  agents: { total: 1204, awaiting: 19, blocked: 84, failed: 2 },
  categories: [
    { name: 'Applications', total: 12, healthy: 12, degraded: 0, failing: 0 },
    { name: 'Databases', total: 9, healthy: 8, degraded: 0, failing: 1 },
  ],
};

/** One goal as the goal rings arena reads it: the goal's own reading and each category's traffic and day. */
const ARENA = {
  name: 'Onboarding Velocity',
  goal: {
    id: 'G-007',
    total: 842,
    working: 645,
    idle: 22,
    awaiting: 33,
    blocked: 94,
    failed: 27,
    overBudget: 21,
    progress: '41%',
    burn: 4.2,
    status: 'blocked',
  },
  categories: [
    {
      id: 'RG-SYS',
      name: 'SYSTEM',
      unit: 'systems of record',
      unitOne: 'system of record',
      total: 9,
      healthy: 1246,
      hold: 'blocked',
      calls: 5400,
      traffic: { flowing: 0.62, blocked: 0.31, awaiting: 0.07 },
      rules: ['R-047'],
      problems: [
        { name: 'crm-prod', where: 'eu-west-1', why: 'writes need a credential grant', state: 'blocked', agents: 84, since: 14, rule: 'R-047' },
      ],
      day: [{ calls: 120, away: 0.3 }, 80],
    },
    { id: 'RG-APP', name: 'APP', total: 12, healthy: 8931, crew: 300, held: 0, overBudget: 4, cpm: 3300, heldUp: '12%' },
  ],
};

describe('assetHealthFits', () => {
  it('fits an agent population plus category health counts', () => {
    expect(assetHealthFits(OVERVIEW)).toBe(true);
  });

  it('fits a WidgetItem object with data rows and agent columns', () => {
    expect(
      assetHealthFits({
        chartType: 'assetHealthOverview',
        data: [
          { category: 'Applications', healthy: 12, agents: 1204, blocked: 84 },
          { category: 'Databases', healthy: 8, failing: 1 },
        ],
      }),
    ).toBe(true);
  });

  it('fits categories the goal rings arena reads by their traffic or day alone', () => {
    expect(
      assetHealthFits({
        goal: { total: 40 },
        categories: [
          { name: 'Apps', traffic: { flowing: 1 } },
          { name: 'Models', day: [{ calls: 12, away: 0 }] },
        ],
      }),
    ).toBe(true);
  });

  it('rejects a plain number and a single health dial', () => {
    expect(assetHealthFits([{ loss: 24.3 }])).toBe(false);
    expect(assetHealthFits([{ unitHealth: 72.8, txPower: 28 }])).toBe(false);
  });

  it('rejects fewer than two categories', () => {
    expect(
      assetHealthFits({
        agents: { total: 10 },
        categories: [{ name: 'Tools', total: 2, healthy: 2 }],
      }),
    ).toBe(false);
  });
});

describe('assetHealthOverviewPayload', () => {
  it('builds the chart object from an overview-shaped row', () => {
    expect(assetHealthOverviewPayload({}, [OVERVIEW])).toEqual({
      chartType: 'assetHealthOverview',
      agents: OVERVIEW.agents,
      categories: OVERVIEW.categories,
    });
  });

  it('passes on what the goal rings arena reads, as sent, and invents no day', () => {
    const out = assetHealthOverviewPayload({}, [ARENA]) as Record<string, unknown>;
    // the chart title names the goal, as the widget paints it
    expect(out.agents).toEqual({ ...ARENA.goal, name: 'Onboarding Velocity' });
    const [sys, app] = out.categories as Record<string, unknown>[];
    expect(sys).toEqual(ARENA.categories[0]);
    expect(app).toEqual({ id: 'RG-APP', name: 'APP', total: 12, healthy: 8931, crew: 300, held: 0, overBudget: 4, calls: 3300, heldUp: '12%' });
    expect(assetHealthOverviewPayload({}, [OVERVIEW])).not.toHaveProperty('wall');
    expect((assetHealthOverviewPayload({}, [OVERVIEW]) as { categories: object[] }).categories[0]).not.toHaveProperty('day');
  });

  it('keeps the chart title and the goal id on one named overview row', () => {
    const named = {
      name: 'Onboarding Velocity',
      goal: { id: 'G-007', name: 'Goal label', total: 1204, awaiting: 19, blocked: 84, failed: 2 },
      categories: OVERVIEW.categories,
    };
    expect(assetHealthFits([named])).toBe(true);
    expect(assetHealthOverviewPayload({}, [named])).toEqual({
      chartType: 'assetHealthOverview',
      name: 'Onboarding Velocity',
      agents: { id: 'G-007', name: 'Onboarding Velocity', total: 1204, awaiting: 19, blocked: 84, failed: 2 },
      categories: OVERVIEW.categories,
    });
  });

  it('keeps the goal name when the overview has no chart title', () => {
    const named = {
      goal: { id: 'G-007', name: 'Onboarding Velocity', total: 1204 },
      categories: OVERVIEW.categories,
    };
    expect(assetHealthOverviewPayload({}, [named])).toEqual({
      chartType: 'assetHealthOverview',
      agents: { id: 'G-007', name: 'Onboarding Velocity', total: 1204 },
      categories: OVERVIEW.categories,
    });
  });

  it('does not take the agent name from a category row', () => {
    expect(
      assetHealthOverviewPayload(
        {},
        [
          { name: 'Applications', healthy: 12, agents: 420 },
          { name: 'Databases', healthy: 8, failing: 1 },
        ],
      ),
    ).toEqual({
      chartType: 'assetHealthOverview',
      agents: { total: 420 },
      categories: [
        { name: 'Applications', healthy: 12 },
        { name: 'Databases', healthy: 8, failing: 1 },
      ],
    });
  });

  it('builds from WidgetItem-style category rows with agent columns', () => {
    expect(
      assetHealthOverviewPayload(
        {},
        [
          { category: 'Applications', healthy: 12, agents: 420, awaiting: 4, failed: 2 },
          { category: 'Databases', healthy: 8, failing: 1 },
        ],
      ),
    ).toEqual({
      chartType: 'assetHealthOverview',
      agents: { total: 420, awaiting: 4, failed: 2 },
      categories: [
        { name: 'Applications', healthy: 12 },
        { name: 'Databases', healthy: 8, failing: 1 },
      ],
    });
  });
});
