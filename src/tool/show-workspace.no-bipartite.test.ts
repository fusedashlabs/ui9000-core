import { describe, expect, it, vi } from 'vitest';

/**
 * A host whose widgets catalog has no bipartite graph yet (an older widgets
 * release). Goals against their resource groups must reach the charts they
 * reached before, not a graph family with nothing to draw them.
 */
vi.mock('@fusedashlabs/widgets/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('@fusedashlabs/widgets/catalog')>();
  return {
    ...real,
    collectPortMetadata: () => real.collectPortMetadata().filter((meta) => meta.id !== 'bipartite-graph'),
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

const GOAL_GROUPS = [
  'goal,agents,resource_group,calls',
  'Perimeter Watch,1108,Camera,14200',
  'Perimeter Watch,1108,Model,8800',
  'Onboarding Velocity,842,System,5400',
  'Onboarding Velocity,842,Camera,2100',
].join('\n');

describe('show_workspace without the bipartite graph in the host catalog', () => {
  it('draws goals against their resource groups as before, not as a graph', async () => {
    const result = await handleShowWorkspace({ intent: 'graph', csv: GOAL_GROUPS }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('bar-chart');
  });

  it('still draws a node–link list as the network graph', async () => {
    const result = await handleShowWorkspace({ intent: 'graph', csv: 'source,target\nA,B\nB,C\nC,A\nA,D\n' }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('network-graph');
  });
});
