import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadEngineCatalog = vi.hoisted(() => vi.fn());

vi.mock('@fusedashlabs/widgets/catalog', () => ({
  loadEngineCatalog,
}));

import { loadWorkspaceCatalog, workspaceCatalogIds } from './load-workspace.js';

describe('loadWorkspaceCatalog filter', () => {
  beforeEach(() => {
    loadEngineCatalog.mockReset();
  });

  it('drops non-engine rows even if the widgets loader leaks them', () => {
    loadEngineCatalog.mockReturnValue([
      { id: 'pie-chart', tier: 'host' },
      { id: 'bar-chart', tier: 'engine' },
      { id: 'custom-widget', tier: 'substrate' },
    ]);

    expect(workspaceCatalogIds()).toEqual(['bar-chart']);
    expect(loadWorkspaceCatalog()).toEqual([{ id: 'bar-chart', tier: 'engine' }]);
  });
});
