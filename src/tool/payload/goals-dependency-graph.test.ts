import { describe, expect, it } from 'vitest';

import { namesGoalGroups } from '../../profiler/goal-group-columns.js';
import { goalsDependencyGraphFits, goalsDependencyGraphPayload } from './goals-dependency-graph.js';
import { graphChart, isGraphChart } from './graph.js';

/** Two goals against the groups they draw on, one row per goal and group, with the hold traced. */
const ROWS = [
  { goal: 'Perimeter Watch', goal_code: 'G-014', agents: 1108, awaiting: 19, progress: 0.88, burn: 1.1, goal_status: 'on track', resource_group: 'Camera', kind: 'camera', state: 'degraded', calls: 14200, held: 0, detail: '7% of streams throttled' },
  { goal: 'Perimeter Watch', goal_code: 'G-014', agents: 1108, awaiting: 19, progress: 0.88, burn: 1.1, goal_status: 'on track', resource_group: 'Model', kind: 'model', state: 'awaiting', calls: 8800, held: 19, cause: 'gateway p95 over threshold', since: '14m', owner: 'ML platform' },
  { goal: 'Onboarding Velocity', goal_code: 'G-007', agents: 842, blocked: 94, progress: '41%', goal_status: 'blocked', resource_group: 'System', kind: 'system', state: 'blocked', calls: 5400, held: 94, cause: 'writes need a credential grant', rule: 'R-047', owner: 'Identity team', since: '2h' },
  { goal: 'Onboarding Velocity', goal_code: 'G-007', agents: 842, blocked: 94, progress: '41%', goal_status: 'blocked', resource_group: 'Camera', kind: 'camera', state: 'healthy', calls: 2100, held: 0 },
];

describe('goals dependency graph payload', () => {
  it('sends each goal with its agents and the groups it draws on, with each hold traced as sent', () => {
    expect(goalsDependencyGraphPayload({}, ROWS)).toEqual({
      chartType: 'goalsDependencyGraph',
      goals: [
        {
          name: 'Perimeter Watch',
          code: 'G-014',
          agents: { total: 1108, awaiting: 19 },
          progress: 0.88,
          multiplier: 1.1,
          status: 'on track',
          resourceGroups: [
            { name: 'Camera', kind: 'camera', state: 'degraded', held: 0, calls: 14200, detail: '7% of streams throttled' },
            { name: 'Model', kind: 'model', state: 'awaiting', held: 19, calls: 8800, cause: 'gateway p95 over threshold', owner: 'ML platform', since: '14m' },
          ],
        },
        {
          name: 'Onboarding Velocity',
          code: 'G-007',
          agents: { total: 842, blocked: 94 },
          progress: '41%',
          status: 'blocked',
          resourceGroups: [
            { name: 'System', kind: 'system', state: 'blocked', held: 94, calls: 5400, cause: 'writes need a credential grant', rule: 'R-047', owner: 'Identity team', since: '2h' },
            { name: 'Camera', kind: 'camera', state: 'healthy', held: 0, calls: 2100 },
          ],
        },
      ],
    });
  });

  it('draws held agents without their calls or a traced cause', () => {
    const rows = [
      { goal: 'A', resource_group: 'System', agents: 40, held: 12 },
      { goal: 'A', resource_group: 'Model', agents: 40, held: 0 },
      { goal: 'B', resource_group: 'System', agents: 12, held: 3 },
    ];
    expect(goalsDependencyGraphPayload({}, rows)).toEqual({
      chartType: 'goalsDependencyGraph',
      goals: [
        { name: 'A', agents: { total: 40 }, resourceGroups: [{ name: 'System', held: 12 }, { name: 'Model', held: 0 }] },
        { name: 'B', agents: { total: 12 }, resourceGroups: [{ name: 'System', held: 3 }] },
      ],
    });
  });

  it('names the graph from a title column that is the same on every row', () => {
    const rows = ROWS.map((row) => ({ ...row, title: 'Agent operations' }));
    expect(goalsDependencyGraphPayload({}, rows)).toMatchObject({ name: 'Agent operations' });
  });

  it('fits a few goals against their groups when something holds their agents, and nothing else', () => {
    expect(goalsDependencyGraphFits(ROWS)).toBe(true);
    // Traffic with nothing held and no hold traced is not a dependency to trace.
    const flowing = ROWS.map(({ goal, agents, resource_group, calls }) => ({ goal, agents, resource_group, calls, held: 0 }));
    expect(goalsDependencyGraphFits(flowing)).toBe(false);
    // A traced cause is a hold, even without a held count.
    expect(goalsDependencyGraphFits(flowing.map((row, i) => (i === 0 ? { ...row, cause: 'credential grant' } : row)))).toBe(true);
    // The widget draws up to eight goals.
    const nine = Array.from({ length: 9 }, (_, i) => ({ goal: `G-${i}`, agents: 10, resource_group: 'System', held: 1 }));
    expect(goalsDependencyGraphFits(nine)).toBe(false);
    expect(goalsDependencyGraphFits(nine.slice(0, 8))).toBe(true);
    // One goal is not goals against groups, and every goal needs its agents.
    expect(goalsDependencyGraphFits(ROWS.slice(0, 2))).toBe(false);
    expect(goalsDependencyGraphFits(ROWS.map((row, i) => (i > 1 ? { ...row, agents: '' } : row)))).toBe(false);
    // A free-form adjacency list has no goal or group.
    expect(goalsDependencyGraphFits([{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }])).toBe(false);
    expect(goalsDependencyGraphFits(null)).toBe(false);
  });

  it('returns null when the rows do not fit', () => {
    expect(goalsDependencyGraphPayload({}, ROWS.slice(0, 2))).toBeNull();
  });
});

describe('goal and resource group columns', () => {
  it('shares its column vocabulary with the family gate', () => {
    expect(namesGoalGroups(Object.keys(ROWS[0]!))).toBe(true);
    expect(namesGoalGroups(['goal', 'resource_group', 'held'])).toBe(true);
    expect(namesGoalGroups(['goal', 'group', 'held'])).toBe(false);
  });
});

describe('graph family drawing with the goals dependency graph', () => {
  it('picks the goals dependency graph for goals held on their groups', () => {
    expect(graphChart(ROWS)).toBe('goals-dependency-graph');
    expect(graphChart([{ source: 'A', target: 'B' }])).toBe('network-graph');
  });

  it('keeps the network graph when the host cannot draw the goals dependency graph', () => {
    expect(graphChart(ROWS, (id) => id !== 'goals-dependency-graph')).toBe('network-graph');
  });

  it('knows the goals dependency graph as a graph drawing', () => {
    expect(isGraphChart('goals-dependency-graph')).toBe(true);
  });
});
