import { describe, expect, it, vi } from 'vitest';

/**
 * A host whose widgets catalog has no goals perimeter yet (an older widgets
 * release). Agents around a goal must reach the charts they reached before,
 * not a graph family with nothing to draw them.
 */
vi.mock('@fusedashlabs/widgets/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('@fusedashlabs/widgets/catalog')>();
  return {
    ...real,
    collectPortMetadata: () => real.collectPortMetadata().filter((meta) => meta.id !== 'goals-perimeter'),
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

const AGENTS_WITH_TASKS = [
  'agent_id,goal,state,tasks',
  'a1,Incident Response,healthy,4',
  'a2,Incident Response,failed,2',
  'a3,Incident Response,healthy,5',
  'a4,Incident Response,blocked,1',
  'a5,Incident Response,healthy,3',
  'a6,Incident Response,healthy,6',
].join('\n');

describe('show_workspace without the goals perimeter in the host catalog', () => {
  it('draws agents around a goal as before, not as a graph', async () => {
    const result = await handleShowWorkspace({ intent: 'graph', csv: AGENTS_WITH_TASKS }, context());
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
