import { describe, expect, it } from 'vitest';

import { namesGoalGroups } from '../../profiler/goal-group-columns.js';
import { bipartiteGraphFits, bipartiteGraphPayload } from './bipartite-graph.js';
import { graphChart, isGraphChart } from './graph.js';

/** Two goals against the groups they draw on, one row per goal and group. */
const ROWS = [
  { goal: 'Perimeter Watch', goal_code: 'G-014', agents: 1108, awaiting: 19, progress: 0.88, burn: '1.1×', goal_status: 'On track', resource_group: 'Camera', kind: 'Camera', state: 'slowed', calls: '14,200', held: 0, detail: '7% of streams throttled' },
  { goal: 'Perimeter Watch', goal_code: 'G-014', agents: 1108, awaiting: 19, progress: 0.88, burn: '1.1×', goal_status: 'On track', resource_group: 'Model', kind: 'Model', state: 'waiting', calls: 8800, held: 19 },
  { goal: 'Onboarding Velocity', goal_code: 'G-007', agents: 842, blocked: 94, progress: '41%', goal_status: 'blocked', resource_group: 'System', kind: 'System', state: 'blocked', calls: 5400, held: 94 },
  { goal: 'Onboarding Velocity', goal_code: 'G-007', agents: 842, blocked: 94, progress: '41%', goal_status: 'blocked', resource_group: 'Camera', kind: 'Camera', state: 'ok', calls: 2100, held: 0 },
];

describe('bipartite graph payload', () => {
  it('sends each goal with its agents and the groups it draws on, a group of one name being one group', () => {
    expect(bipartiteGraphPayload({}, ROWS)).toEqual({
      chartType: 'bipartiteGraph',
      goals: [
        {
          name: 'Perimeter Watch',
          code: 'G-014',
          agents: { total: 1108, awaiting: 19 },
          health: 0.88,
          multiplier: 1.1,
          status: 'on track',
          resourceGroups: [
            { name: 'Camera', kind: 'camera', state: 'degraded', held: 0, calls: 14200, detail: '7% of streams throttled' },
            { name: 'Model', kind: 'model', state: 'awaiting', held: 19, calls: 8800 },
          ],
        },
        {
          name: 'Onboarding Velocity',
          code: 'G-007',
          agents: { total: 842, blocked: 94 },
          health: '41%',
          status: 'blocked',
          resourceGroups: [
            { name: 'System', kind: 'system', state: 'blocked', held: 94, calls: 5400 },
            { name: 'Camera', kind: 'camera', state: 'healthy', held: 0, calls: 2100 },
          ],
        },
      ],
    });
  });

  it('invents nothing the rows do not send', () => {
    const rows = [
      { goal: 'A', resource_group: 'Camera', agents: 40, calls: 300 },
      { goal: 'B', resource_group: 'Camera', agents: 12, calls: 90 },
    ];
    expect(bipartiteGraphPayload({}, rows)).toEqual({
      chartType: 'bipartiteGraph',
      goals: [
        { name: 'A', agents: { total: 40 }, resourceGroups: [{ name: 'Camera', calls: 300 }] },
        { name: 'B', agents: { total: 12 }, resourceGroups: [{ name: 'Camera', calls: 90 }] },
      ],
    });
  });

  it('takes the goal columns from whichever of its rows sends them', () => {
    const rows = [
      { goal: 'A', resource_group: 'Camera', agents: '', calls: 300 },
      { goal: 'A', resource_group: 'Model', agents: 40, calls: 20 },
      { goal: 'B', resource_group: 'Camera', agents: 12, calls: 90 },
    ];
    const payload = bipartiteGraphPayload({}, rows) as { goals: { agents: unknown }[] };
    expect(payload.goals[0]!.agents).toEqual({ total: 40 });
  });

  it('names the map from a title column that is the same on every row', () => {
    const rows = ROWS.map((row) => ({ ...row, title: 'Agent operations' }));
    expect(bipartiteGraphPayload({}, rows)).toMatchObject({ name: 'Agent operations' });
  });

  it('fits goals against their groups with the calls on every link, and nothing else', () => {
    expect(bipartiteGraphFits(ROWS)).toBe(true);
    // A link without its calls has no ribbon width.
    expect(bipartiteGraphFits(ROWS.map((row, i) => (i === 1 ? { ...row, calls: '' } : row)))).toBe(false);
    // A hold traced to its cause is the dependency graph's reading.
    expect(bipartiteGraphFits(ROWS.map((row, i) => (i === 2 ? { ...row, cause: 'credential grant' } : row)))).toBe(false);
    // One goal is not goals against groups.
    expect(bipartiteGraphFits(ROWS.slice(0, 2))).toBe(false);
    // Every goal needs its agents.
    expect(bipartiteGraphFits(ROWS.map(({ agents, ...row }) => (row.goal === 'Onboarding Velocity' ? row : { ...row, agents })))).toBe(false);
    // A pair that repeats is not one link.
    expect(bipartiteGraphFits([...ROWS, ROWS[0]!])).toBe(false);
    // A free-form adjacency list has no goal or group.
    expect(bipartiteGraphFits([{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }])).toBe(false);
    expect(bipartiteGraphFits(null)).toBe(false);
    expect(bipartiteGraphFits({ rows: ROWS })).toBe(false);
  });

  it('returns null when the rows do not fit', () => {
    expect(bipartiteGraphPayload({}, ROWS.slice(0, 2))).toBeNull();
  });
});

describe('goal and resource group columns', () => {
  it('shares its column vocabulary with the family gate', () => {
    expect(namesGoalGroups(Object.keys(ROWS[0]!))).toBe(true);
    expect(namesGoalGroups(['Goal', 'Resource Group', 'Calls per minute'])).toBe(true);
    expect(namesGoalGroups(['goal', 'resource_group', 'held'])).toBe(true);
    // Without the calls or the agents held, or without the group, it is not goals against their groups.
    expect(namesGoalGroups(['goal', 'resource_group', 'agents'])).toBe(false);
    expect(namesGoalGroups(['goal', 'calls'])).toBe(false);
  });

  it('does not read a bare group or resource as a resource group', () => {
    expect(namesGoalGroups(['goal', 'group', 'calls'])).toBe(false);
    expect(namesGoalGroups(['goal', 'resource', 'calls'])).toBe(false);
    expect(bipartiteGraphFits(ROWS.map(({ resource_group, ...row }) => ({ ...row, group: resource_group })))).toBe(false);
  });
});

describe('graph family drawing with the bipartite graph', () => {
  it('picks the bipartite graph for goals against their groups', () => {
    expect(graphChart(ROWS)).toBe('bipartite-graph');
    expect(graphChart([{ source: 'A', target: 'B' }])).toBe('network-graph');
  });

  it('keeps the network graph when the host cannot draw the bipartite graph', () => {
    expect(graphChart(ROWS, (id) => id !== 'bipartite-graph')).toBe('network-graph');
  });

  it('knows the bipartite graph as a graph drawing', () => {
    expect(isGraphChart('bipartite-graph')).toBe(true);
  });
});
