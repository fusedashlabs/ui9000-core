import { describe, expect, it, vi } from 'vitest';

/**
 * A host whose widgets catalog has no goals dependency graph yet (an older
 * widgets release). Goals held on their resource groups must reach the
 * charts they reached before, not a graph family with nothing to draw them.
 */
vi.mock('@fusedashlabs/widgets/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('@fusedashlabs/widgets/catalog')>();
  return {
    ...real,
    collectPortMetadata: () => real.collectPortMetadata().filter((meta) => meta.id !== 'goals-dependency-graph'),
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

const HELD = [
  'goal,agents,resource_group,held',
  'Perimeter Watch,1108,Camera,0',
  'Perimeter Watch,1108,Model,19',
  'Onboarding Velocity,842,System,94',
  'Onboarding Velocity,842,Camera,0',
].join('\n');

describe('show_workspace without the goals dependency graph in the host catalog', () => {
  it('draws goals held on their resource groups as before, not as a graph', async () => {
    const result = await handleShowWorkspace({ intent: 'graph', csv: HELD }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('bar-chart');
  });
});
