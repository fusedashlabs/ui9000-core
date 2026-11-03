import { describe, expect, it, vi } from 'vitest';

/**
 * A host whose widgets catalog has no goal burst yet (an older widgets
 * release). One goal's resource groups with their answer times must reach
 * the asset health overview, as they did before.
 */
vi.mock('@fusedashlabs/widgets/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('@fusedashlabs/widgets/catalog')>();
  return {
    ...real,
    collectPortMetadata: () => real.collectPortMetadata().filter((meta) => meta.id !== 'goal-burst'),
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

const BURST = [
  'resource_group,agents,healthy,held,calls,p50_ms,p95_ms',
  'SYSTEM,842,1246,94,5400,240,700',
  'APP,,8931,0,3300,,',
].join('\n');

describe('show_workspace without the goal burst in the host catalog', () => {
  it('draws one goal\'s resource groups as the asset health overview', async () => {
    const result = await handleShowWorkspace({ intent: 'summary', csv: BURST }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('asset-health-overview');
  });
});
