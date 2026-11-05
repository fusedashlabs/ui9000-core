import { describe, expect, it } from 'vitest';

import { namesOrchestration } from '../../profiler/orchestration-columns.js';
import { graphChart, isGraphChart } from './graph.js';
import { reasoningOrchestrationFits, reasoningOrchestrationPayload } from './reasoning-orchestration-graph.js';

/** One row per reasoning step, with the step it came from. */
const STEPS = [
  { step_id: 'q', parent_id: '', stage: 'Prompt', model: '', status: 'verified', score: '1', active: 'yes', accuracy: '' },
  { step_id: 's1', parent_id: 'q', stage: 'Sample', model: 'Astra', status: 'candidate', score: '0.4', active: 'no', accuracy: '0.30' },
  { step_id: 's2', parent_id: 'q', stage: 'Sample', model: 'Astra', status: 'candidate', score: '0.7', active: 'yes', accuracy: '0.32' },
  { step_id: 's3', parent_id: 'q', stage: 'Sample', model: 'Astra', status: 'pruned', score: '0.2', active: 'no', accuracy: '' },
  { step_id: 'v1', parent_id: 's2', stage: 'Verify', model: 'Opus', status: 'verified', score: '0.8', active: 'yes', accuracy: '0.52' },
  { step_id: 'v2', parent_id: 's1', stage: 'Verify', model: 'Opus', status: 'pruned', score: '0.3', active: 'no', accuracy: '0.48' },
  { step_id: 'r1', parent_id: 'v1', stage: 'Repair', model: 'Opus', status: 'refined', score: '0.9', active: 'yes', accuracy: '0.59' },
];

describe('reasoning orchestration payload', () => {
  it('sends stages, nodes, links, models and the flagged chain as the active path', () => {
    expect(reasoningOrchestrationPayload({}, STEPS)).toEqual({
      chartType: 'reasoningOrchestrationGraph',
      models: [
        { id: 'Astra', name: 'Astra' },
        { id: 'Opus', name: 'Opus' },
      ],
      stages: [
        { id: 'Prompt', label: 'Prompt' },
        { id: 'Sample', label: 'Sample', metrics: { accuracy: 0.31 } },
        { id: 'Verify', label: 'Verify', metrics: { accuracy: 0.5 } },
        { id: 'Repair', label: 'Repair', metrics: { accuracy: 0.59 } },
      ],
      nodes: [
        { id: 'q', stage: 'Prompt', state: 'verified', score: 1 },
        { id: 's1', parent: 'q', stage: 'Sample', model: 'Astra', state: 'candidate', score: 0.4 },
        { id: 's2', parent: 'q', stage: 'Sample', model: 'Astra', state: 'candidate', score: 0.7 },
        { id: 's3', parent: 'q', stage: 'Sample', model: 'Astra', state: 'pruned', score: 0.2 },
        { id: 'v1', parent: 's2', stage: 'Verify', model: 'Opus', state: 'verified', score: 0.8 },
        { id: 'v2', parent: 's1', stage: 'Verify', model: 'Opus', state: 'pruned', score: 0.3 },
        { id: 'r1', parent: 'v1', stage: 'Repair', model: 'Opus', state: 'refined', score: 0.9 },
      ],
      links: [
        { source: 'q', target: 's1' },
        { source: 'q', target: 's2' },
        { source: 'q', target: 's3' },
        { source: 's2', target: 'v1' },
        { source: 's1', target: 'v2' },
        { source: 'v1', target: 'r1' },
      ],
      activePath: ['q', 's2', 'v1', 'r1'],
    });
  });

  it('takes candidate paths from a path column and the active one from a named id', () => {
    const rows = [
      { node: 'q', parent: '', depth: 0, path: 'a', active_path: 'b' },
      { node: 'a1', parent: 'q', depth: 1, path: 'a', active_path: 'b' },
      { node: 'a2', parent: 'a1', depth: 2, path: 'a', active_path: 'b' },
      { node: 'b1', parent: 'q', depth: 1, path: 'b', active_path: 'b' },
      { node: 'b2', parent: 'b1', depth: 2, path: 'b', active_path: 'b' },
      { node: 'b3', parent: 'b2', depth: 3, path: 'b', active_path: 'b' },
    ];
    const payload = reasoningOrchestrationPayload({}, rows) as { paths: unknown[]; activePath: unknown; stages?: unknown };
    // The active path is sent first.
    expect(payload.paths).toEqual([
      { id: 'b', label: 'b', nodes: ['q', 'b1', 'b2', 'b3'] },
      { id: 'a', label: 'a', nodes: ['q', 'a1', 'a2'] },
    ]);
    expect(payload.activePath).toBe('b');
    expect(payload.stages).toBeUndefined();
  });

  it('reads a source,target table whose other columns describe the target', () => {
    const rows = [
      { source: 'q', target: 'a', stage: 'Explore', active: 'false', entropy: '1.2' },
      { source: 'q', target: 'b', stage: 'Explore', active: 'true', entropy: '0.9' },
      { source: 'b', target: 'c', stage: 'Repair', active: 'true', entropy: '0.4' },
      { source: 'a', target: 'd', stage: 'Repair', active: 'false', entropy: '0.8' },
    ];
    const payload = reasoningOrchestrationPayload({}, rows) as {
      nodes: { id: string; stage?: string }[];
      links: unknown[];
      activePath: unknown;
      entropy: unknown;
    };
    expect(payload.nodes.map((node) => [node.id, node.stage])).toEqual([
      ['a', 'Explore'],
      ['q', undefined],
      ['b', 'Explore'],
      ['c', 'Repair'],
      ['d', 'Repair'],
    ]);
    expect(payload.links).toHaveLength(4);
    expect(payload.activePath).toEqual(['q', 'b', 'c']);
    expect(payload.entropy).toEqual({ series: [{ label: 'entropy', values: [1.2, 0.9, 0.4, 0.8] }] });
  });

  it('fits reasoning steps with an active path, and nothing else', () => {
    expect(reasoningOrchestrationFits(STEPS)).toBe(true);
    // A free-form adjacency list: no stage, no active path.
    const adjacency = Array.from({ length: 8 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
    expect(reasoningOrchestrationFits(adjacency)).toBe(false);
    // Stages but nothing to highlight.
    expect(reasoningOrchestrationFits(adjacency.map((row, i) => ({ ...row, stage: `S${i % 3}` })))).toBe(false);
    // A flag but no stage or depth.
    expect(reasoningOrchestrationFits(STEPS.map(({ stage: _stage, ...row }) => row))).toBe(false);
    // Nothing flagged.
    expect(reasoningOrchestrationFits(STEPS.map((row) => ({ ...row, active: 'no' })))).toBe(false);
    // Too few steps.
    expect(reasoningOrchestrationFits(STEPS.slice(0, 2))).toBe(false);
    // A step with no id.
    expect(reasoningOrchestrationFits([...STEPS, { ...STEPS[1]!, step_id: '' }])).toBe(false);
    expect(reasoningOrchestrationFits(null)).toBe(false);
  });

  it('fits an object that already names nodes, stages and the active path', () => {
    const graph = {
      nodes: [{ id: 'q' }, { id: 'a', stage: 'Explore' }],
      links: [{ source: 'q', target: 'a' }],
      activePath: ['q', 'a'],
    };
    expect(reasoningOrchestrationFits(graph)).toBe(true);
    expect(reasoningOrchestrationFits({ ...graph, activePath: undefined })).toBe(false);
    expect(reasoningOrchestrationFits({ nodes: [{ id: 'a' }], links: [], activePathId: 'p' })).toBe(false);
  });

  it('returns null when the rows do not fit', () => {
    expect(reasoningOrchestrationPayload({}, [{ source: 'A', target: 'B' }])).toBeNull();
  });

  it('shares its column vocabulary with the family gate', () => {
    expect(namesOrchestration(Object.keys(STEPS[0]!))).toBe(true);
    expect(namesOrchestration(['source', 'target', 'depth', 'selected'])).toBe(true);
    expect(namesOrchestration(['source', 'target', 'value'])).toBe(false);
    expect(namesOrchestration(['source', 'target', 'stage'])).toBe(false);
  });
});

describe('graph family drawing', () => {
  const adjacency = Array.from({ length: 8 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));

  it('picks the orchestration graph for reasoning steps, and the network graph otherwise', () => {
    expect(graphChart(STEPS)).toBe('reasoning-orchestration-graph');
    expect(graphChart(adjacency)).toBe('network-graph');
    expect(graphChart([])).toBe('network-graph');
  });

  it('keeps the network graph when the host cannot draw the orchestration', () => {
    expect(graphChart(STEPS, (id) => id !== 'reasoning-orchestration-graph')).toBe('network-graph');
  });

  it('knows its two drawings', () => {
    expect(isGraphChart('network-graph')).toBe(true);
    expect(isGraphChart('reasoning-orchestration-graph')).toBe(true);
    expect(isGraphChart('kpi-widget')).toBe(false);
  });
});
