import { describe, expect, it, vi } from 'vitest';

/**
 * A host whose widgets catalog has no reasoning orchestration graph yet (an
 * older widgets release). Reasoning steps must reach the charts they reached
 * before, not a graph family with nothing to draw them.
 */
vi.mock('@fusedashlabs/widgets/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('@fusedashlabs/widgets/catalog')>();
  return {
    ...real,
    collectPortMetadata: () =>
      real.collectPortMetadata().filter((meta) => meta.id !== 'reasoning-orchestration-graph'),
  };
});

import { loadWorkspaceCatalog } from '../catalog/load-workspace.js';
import { handleShowWorkspace, type ShowWorkspaceContext } from './show-workspace.js';

function context(): ShowWorkspaceContext {
  return {
    catalog: loadWorkspaceCatalog(),
    profile: {},
    payload: [],
    signDataLink: (payload: unknown) => ({ dataUrl: `https://workspace.local/v1/data-links/${JSON.stringify(payload).length}` }),
  };
}

const STEPS_WITH_SCORES = [
  'step_id,parent_id,stage,score,active',
  'q,,Prompt,1,yes',
  's1,q,Sample,0.4,no',
  's2,q,Sample,0.7,yes',
  'v1,s2,Verify,0.8,yes',
  'v2,s1,Verify,0.3,no',
  'r1,v1,Repair,0.9,yes',
].join('\n');

describe('show_workspace without the reasoning orchestration graph in the host catalog', () => {
  it('draws reasoning steps as before, not as a graph', async () => {
    const result = await handleShowWorkspace({ intent: 'graph', csv: STEPS_WITH_SCORES }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).not.toBe('reasoning-orchestration-graph');
    expect(result.spec.component).not.toBe('network-graph');
  });

  it('draws a link table with stages and an active flag as the network graph', async () => {
    const csv = 'source,target,stage,active\nq,a,S1,no\nq,b,S1,yes\nb,c,S2,yes\na,d,S2,no\n';
    const result = await handleShowWorkspace({ intent: 'graph', csv }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('network-graph');
  });
});
