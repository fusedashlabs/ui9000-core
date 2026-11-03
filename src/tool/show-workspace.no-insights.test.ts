import { describe, expect, it, vi } from 'vitest';

/**
 * A host whose widgets catalog has no goals and insights yet (an older
 * widgets release). Claims filed under goals must reach the charts they
 * reached before, not a graph family with nothing to draw them.
 */
vi.mock('@fusedashlabs/widgets/catalog', async (importOriginal) => {
  const real = await importOriginal<typeof import('@fusedashlabs/widgets/catalog')>();
  return {
    ...real,
    collectPortMetadata: () => real.collectPortMetadata().filter((meta) => meta.id !== 'goals-insights'),
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

const CLAIMS = [
  'goal,claim,polarity,sources,age',
  'G-014,Firmware 4.2 cameras recover within 90 seconds,confirming,6,60.5',
  'G-022,Decommissioned servers are still listed as live,contradicting,3,57.9',
  'G-014,Gate 3 tailgating alerts down 40% week on week,confirming,5,52.3',
  'G-014,Hall C aisle 07 has no motion coverage,contradicting,3,6.4',
  'G-022,Hall C aisle 07 cameras are missing from the visibility map,contradicting,3,5.8',
  'G-014,Video triage lane p95 1.9s against a 1.2s threshold,contradicting,3,0.6',
].join('\n');

describe('show_workspace without goals and insights in the host catalog', () => {
  it('draws claims filed under goals as before, not as a graph', async () => {
    const result = await handleShowWorkspace({ intent: 'graph', csv: CLAIMS }, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.component).toBe('bar-chart');
  });
});
