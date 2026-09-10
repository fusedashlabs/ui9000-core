import { describe, expect, it } from 'vitest';

import {
  catalogTierOf,
  collectPortMetadata,
  ENGINE_TARGET_IDS,
} from '@fusedashlabs/widgets/catalog';

import { loadWorkspaceCatalog, workspaceCatalogIds } from './load-workspace.js';

/** Non-engine ids that must never reach the engine, by tier or by frozen scope. */
const FORBIDDEN_IDS = [
  'custom-widget',
  'chart-renderer',
  'pie-chart',
  'sankey-chart',
  'sankey',
  'roc-curve',
];

describe('loadWorkspaceCatalog', () => {
  it('returns exactly ENGINE_TARGET_IDS, in order', () => {
    expect(workspaceCatalogIds()).toEqual([...ENGINE_TARGET_IDS]);
  });

  it('is the frozen set of 20 engine ids', () => {
    expect(loadWorkspaceCatalog()).toHaveLength(20);
    expect(ENGINE_TARGET_IDS).toHaveLength(20);
  });

  it('carries only tier engine', () => {
    for (const entry of loadWorkspaceCatalog()) {
      expect((entry as { tier?: string }).tier, entry.id).toBe('engine');
    }
  });

  it('leaks no substrate or host component', () => {
    const ids = new Set(workspaceCatalogIds());
    const seen = { substrate: 0, host: 0 };
    for (const meta of collectPortMetadata()) {
      const tier = catalogTierOf(meta);
      if (tier === 'engine') continue;
      seen[tier] += 1;
      expect(ids.has(meta.id), `${meta.id} (${tier}) leaked into the engine catalog`).toBe(
        false,
      );
    }
    // Guard the guard: a glob that matched nothing would pass vacuously.
    expect(seen.substrate + seen.host).toBeGreaterThan(0);
  });

  it('excludes the named non-engine widgets', () => {
    const ids = new Set(workspaceCatalogIds());
    for (const id of FORBIDDEN_IDS) {
      expect(ids.has(id), `${id} must not be in the engine catalog`).toBe(false);
    }
  });

  it('does not redeclare the id list in core', () => {
    // The only source of truth is widgets; core imports it.
    expect(workspaceCatalogIds()).toEqual([...ENGINE_TARGET_IDS]);
    expect(new Set(workspaceCatalogIds()).size).toBe(ENGINE_TARGET_IDS.length);
  });
});
