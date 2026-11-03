import { describe, expect, it } from 'vitest';

import { namesGoalHealth } from '../../profiler/goal-group-columns.js';
import { namesPerimeter } from '../../profiler/perimeter-columns.js';
import { goalsPerimeterFits, goalsPerimeterPayload } from './goals-perimeter.js';
import { graphChart, isGraphChart } from './graph.js';

function agents(
  count: number,
  goal = 'Perimeter Watch',
  state: (i: number) => string = (i) => (i % 4 === 0 ? 'failed' : 'healthy'),
) {
  return Array.from({ length: count }, (_, i) => ({
    agent_id: `agent-${i + 1}`,
    goal,
    state: state(i),
  }));
}

describe('goals perimeter payload', () => {
  it('sends the goal, the agent nodes and the exception count', () => {
    const rows = [
      ...agents(6),
      { agent_id: 'agent-7', goal: 'Perimeter Watch', state: 'Blocked', reason: 'Geo-fence policy', blocker: 'rule' },
      { agent_id: 'agent-8', goal: 'Perimeter Watch', state: 'warning', reason: 'Slow scans', blocker: 'rule' },
    ];
    expect(goalsPerimeterPayload({}, rows)).toEqual({
      chartType: 'goalsPerimeter',
      goals: [{ name: 'Perimeter Watch' }],
      agents: [
        { id: 'agent-1', state: 'failed', goal: 'Perimeter Watch' },
        { id: 'agent-2', state: 'healthy', goal: 'Perimeter Watch' },
        { id: 'agent-3', state: 'healthy', goal: 'Perimeter Watch' },
        { id: 'agent-4', state: 'healthy', goal: 'Perimeter Watch' },
        { id: 'agent-5', state: 'failed', goal: 'Perimeter Watch' },
        { id: 'agent-6', state: 'healthy', goal: 'Perimeter Watch' },
        { id: 'agent-7', state: 'blocked', goal: 'Perimeter Watch', reason: 'Geo-fence policy', blocker: 'rule' },
        // A blocker kind only belongs to a blocked agent.
        { id: 'agent-8', state: 'degraded', goal: 'Perimeter Watch', reason: 'Slow scans' },
      ],
      exceptionCount: 4,
    });
  });

  it('takes the exception count from its column, per goal, when every goal has one', () => {
    const rows = [
      ...agents(6, 'Alpha').map((row) => ({ ...row, exceptions: '12' })),
      ...agents(6, 'Beta').map((row) => ({ ...row, agent_id: `beta-${row.agent_id}`, exceptions: 3 })),
    ];
    const payload = goalsPerimeterPayload({}, rows) as { goals: unknown[]; exceptionCount: number };
    expect(payload.goals).toEqual([
      { name: 'Alpha', exceptionCount: 12 },
      { name: 'Beta', exceptionCount: 3 },
    ]);
    expect(payload.exceptionCount).toBe(15);
  });

  it('reads links from a link column, and lets an agent repeat for each link', () => {
    const rows = [
      { agent: 'a1', goal: 'G', status: 'ok', depends_on: 'PagerDuty', link_status: 'Down' },
      { agent: 'a1', goal: 'G', status: 'ok', depends_on: 'a2' },
      { agent: 'a2', goal: 'G', status: 'error', depends_on: '' },
      { agent: 'a3', goal: 'G', status: 'ok', depends_on: 'a3' },
      { agent: 'a4', goal: 'G', status: 'ok', depends_on: 'a1' },
      { agent: 'a5', goal: 'G', status: 'idle', depends_on: 'a1' },
      { agent: 'a6', goal: 'G', status: 'ok', depends_on: 'a2' },
    ];
    const payload = goalsPerimeterPayload({}, rows) as {
      agents: { id: string; state: string }[];
      links: unknown[];
    };
    expect(payload.agents.map((a) => [a.id, a.state])).toEqual([
      ['a1', 'healthy'],
      ['a2', 'failed'],
      ['a3', 'healthy'],
      ['a4', 'healthy'],
      ['a5', 'idle'],
      ['a6', 'healthy'],
    ]);
    expect(payload.links).toEqual([
      { source: 'a1', target: 'PagerDuty', status: 'down' },
      { source: 'a1', target: 'a2' },
      { source: 'a4', target: 'a1' },
      { source: 'a5', target: 'a1' },
      { source: 'a6', target: 'a2' },
    ]);
  });

  it('reads a source,target table with a goal and a state as agents and their links', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      source: `a${i}`,
      target: `a${(i + 1) % 6}`,
      goal: 'G',
      health: i === 2 ? 'degraded' : 'healthy',
    }));
    const payload = goalsPerimeterPayload({}, rows) as { agents: unknown[]; links: unknown[]; exceptionCount: number };
    expect(payload.agents).toHaveLength(6);
    expect(payload.links).toHaveLength(6);
    expect(payload.exceptionCount).toBe(1);
  });

  it('names the board from a title column that is the same on every row', () => {
    const rows = agents(6).map((row) => ({ ...row, title: 'Perimeter agents' }));
    expect(goalsPerimeterPayload({}, rows)).toMatchObject({ name: 'Perimeter agents' });
  });

  it('fits agents around few goals, and nothing else', () => {
    expect(goalsPerimeterFits(agents(6))).toBe(true);
    expect(goalsPerimeterFits(agents(30))).toBe(true);
    // Too few agents to be a population.
    expect(goalsPerimeterFits(agents(5))).toBe(false);
    // A free-form adjacency list: no goal, no state.
    expect(goalsPerimeterFits([{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }])).toBe(false);
    expect(
      goalsPerimeterFits(Array.from({ length: 8 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}`, goal: 'G' }))),
    ).toBe(false);
    // States that are not health words.
    expect(goalsPerimeterFits(agents(8, 'G', () => 'shipped'))).toBe(false);
    // One goal per agent is a comparison of goals, not agents around one.
    expect(goalsPerimeterFits(agents(12).map((row, i) => ({ ...row, goal: `Goal ${i % 6}` })))).toBe(false);
    // A repeated agent without a link column is not one population.
    expect(goalsPerimeterFits([...agents(6), agents(1)[0]!])).toBe(false);
    expect(goalsPerimeterFits(null)).toBe(false);
    expect(goalsPerimeterFits({ rows: agents(6) })).toBe(false);
  });

  it('reads awaiting agents as the widget draws them, apart from blocked ones', () => {
    const rows = agents(8, 'Perimeter Watch', (i) => ['healthy', 'awaiting', 'on hold', 'pending', 'blocked'][i % 5]!);
    const payload = goalsPerimeterPayload({}, rows) as { agents: { state: string }[]; exceptionCount: number };
    expect(payload.agents.map((agent) => agent.state)).toEqual([
      'healthy',
      'awaiting',
      'awaiting',
      'awaiting',
      'blocked',
      'healthy',
      'awaiting',
      'awaiting',
    ]);
    expect(payload.exceptionCount).toBe(6);
  });

  it('returns null when the rows do not fit', () => {
    expect(goalsPerimeterPayload({}, agents(3))).toBeNull();
  });
});

/** Two goals of the Agent operations board, one row per goal and resource group. */
const BOARD = [
  { goal_code: 'G-014', goal: 'Perimeter Watch', goal_status: 'on track', agents: 1108, healthy: 1070, idle: 19, awaiting: 19, progress: '88%', burn: 1.1, resource_group: 'Camera', kind: 'camera', state: 'degraded', calls: 14200, held: 0, detail: '7% of streams throttled' },
  { goal_code: 'G-014', goal: 'Perimeter Watch', goal_status: 'on track', agents: 1108, healthy: 1070, idle: 19, awaiting: 19, progress: '88%', burn: 1.1, resource_group: 'Model', kind: 'model', state: 'awaiting', calls: 8800, held: 19 },
  { goal_code: 'G-007', goal: 'Onboarding Velocity', goal_status: 'blocked', agents: 842, healthy: 645, idle: 22, awaiting: 33, blocked: 94, failed: 27, degraded: 21, progress: '41%', burn: '4.2×', resource_group: 'System', kind: 'system', state: 'blocked', calls: 5400, held: 94, detail: 'Credential grant required' },
  { goal_code: 'G-007', goal: 'Onboarding Velocity', goal_status: 'blocked', agents: 842, healthy: 645, idle: 22, awaiting: 33, blocked: 94, failed: 27, degraded: 21, progress: '41%', burn: '4.2×', resource_group: 'Tool', kind: 'tool', state: 'failed', calls: 1800, held: 27 },
];

describe('goals perimeter from goals and their resource groups', () => {
  it('sends each goal with its agents by state, its readouts and its groups', () => {
    expect(goalsPerimeterPayload({}, BOARD)).toEqual({
      chartType: 'goalsPerimeter',
      goals: [
        {
          name: 'Perimeter Watch',
          code: 'G-014',
          agents: { total: 1108, healthy: 1070, idle: 19, awaiting: 19 },
          health: '88%',
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
          agents: { total: 842, healthy: 645, idle: 22, awaiting: 33, blocked: 94, failed: 27, degraded: 21 },
          health: '41%',
          multiplier: 4.2,
          status: 'blocked',
          resourceGroups: [
            { name: 'System', kind: 'system', state: 'blocked', held: 94, calls: 5400, detail: 'Credential grant required' },
            { name: 'Tool', kind: 'tool', state: 'failed', held: 27, calls: 1800 },
          ],
        },
      ],
    });
  });

  it('names the board from a title column that is the same on every row', () => {
    const rows = BOARD.map((row) => ({ ...row, title: 'Agent operations' }));
    expect(goalsPerimeterPayload({}, rows)).toMatchObject({ name: 'Agent operations' });
  });

  it('fits one to eight goals, only when every goal counts its healthy agents', () => {
    expect(goalsPerimeterFits(BOARD)).toBe(true);
    // Without the healthy count it is goals against groups, not population health.
    expect(goalsPerimeterFits(BOARD.map(({ healthy, ...row }) => (void healthy, row)))).toBe(false);
    expect(goalsPerimeterFits(BOARD.map((row, i) => (i > 1 ? { ...row, healthy: '' } : row)))).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ goal: `G-${i}`, agents: 10, healthy: 9, resource_group: 'Model', held: 1 }));
    expect(goalsPerimeterFits(nine)).toBe(false);
    expect(goalsPerimeterFits(nine.slice(0, 8))).toBe(true);
    // One goal is a perimeter of its own.
    expect(goalsPerimeterFits(BOARD.slice(0, 2))).toBe(true);
    expect(goalsPerimeterPayload({}, BOARD.slice(0, 2))).toMatchObject({
      goals: [{ name: 'Perimeter Watch', resourceGroups: [{ name: 'Camera' }, { name: 'Model' }] }],
    });
  });

  it('shares its column vocabulary with the family gate', () => {
    expect(namesGoalHealth(Object.keys(BOARD[0]!))).toBe(true);
    expect(namesGoalHealth(['goal', 'resource_group', 'held', 'agents'])).toBe(false);
    expect(namesGoalHealth(['goal', 'healthy', 'agents'])).toBe(false);
  });

  it('draws as the goals perimeter in the graph family', () => {
    expect(graphChart(BOARD)).toBe('goals-perimeter');
    // Without the perimeter, goals whose agents are held on their groups are the goals dependency graph.
    expect(graphChart(BOARD, (id) => id !== 'goals-perimeter')).toBe('goals-dependency-graph');
    expect(graphChart(BOARD, (id) => id === 'network-graph')).toBe('network-graph');
  });
});

describe('goals perimeter columns', () => {
  it('shares its column vocabulary with the family gate', () => {
    expect(namesPerimeter(Object.keys(agents(1)[0]!))).toBe(true);
    expect(namesPerimeter(['Agent Name', 'Health', 'Objective'])).toBe(true);
    expect(namesPerimeter(['source', 'target', 'status', 'goal'])).toBe(true);
    expect(goalsPerimeterFits(agents(8).map(({ agent_id, ...row }) => ({ source: agent_id, target: 'PagerDuty', ...row })))).toBe(true);
    // Without the goal, or a source without its target, it is not agents around a goal.
    expect(namesPerimeter(['agent_id', 'state'])).toBe(false);
    expect(namesPerimeter(['source', 'state', 'goal'])).toBe(false);
  });

  it('does not read a bare id as an agent, on either side', () => {
    const records = agents(8).map(({ agent_id, ...row }) => ({ id: agent_id, ...row }));
    expect(namesPerimeter(Object.keys(records[0]!))).toBe(false);
    expect(goalsPerimeterFits(records)).toBe(false);
    expect(goalsPerimeterPayload({}, records)).toBeNull();
  });
});

describe('graph family drawing', () => {
  const adjacency = Array.from({ length: 8 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));

  it('picks the goals perimeter for agents around goals, and the network graph otherwise', () => {
    expect(graphChart(agents(12))).toBe('goals-perimeter');
    expect(graphChart(adjacency)).toBe('network-graph');
    expect(graphChart([])).toBe('network-graph');
  });

  it('keeps the network graph when the host cannot draw the perimeter', () => {
    expect(graphChart(agents(12), (id) => id !== 'goals-perimeter')).toBe('network-graph');
  });

  it('knows its two drawings', () => {
    expect(isGraphChart('network-graph')).toBe(true);
    expect(isGraphChart('goals-perimeter')).toBe(true);
    expect(isGraphChart('kpi-widget')).toBe(false);
  });
});
