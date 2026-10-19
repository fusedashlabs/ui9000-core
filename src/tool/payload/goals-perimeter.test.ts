import { describe, expect, it } from 'vitest';

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

  it('returns null when the rows do not fit', () => {
    expect(goalsPerimeterPayload({}, agents(3))).toBeNull();
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
