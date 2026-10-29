import { describe, expect, it } from 'vitest';

import { assetHealthFits, assetHealthOverviewPayload } from './asset-health-overview.js';

const OVERVIEW = {
  agents: { total: 1204, awaiting: 19, blocked: 84, failed: 2 },
  categories: [
    { name: 'Applications', total: 12, healthy: 12, degraded: 0, failing: 0 },
    { name: 'Databases', total: 9, healthy: 8, degraded: 0, failing: 1 },
  ],
};

const WALL = [{ slot: 12, err: true, reqs: 8, nErr: 2 }];

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
        wall: WALL,
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

  it('passes through an explicit wall and does not invent one', () => {
    expect(assetHealthOverviewPayload({}, [{ ...OVERVIEW, wall: WALL }])).toEqual({
      chartType: 'assetHealthOverview',
      agents: OVERVIEW.agents,
      categories: OVERVIEW.categories,
      wall: WALL,
    });
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
