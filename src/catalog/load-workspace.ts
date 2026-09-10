/**
 * Engine catalog for the decision engine, sourced from the widgets workspace.
 *
 * Thin wrapper over the widgets loader — core never copies metadata.json.
 * The tier filter is core's own boundary guarantee: only `tier: "engine"`
 * entries reach decide() / validateSpec(), whatever the loader hands back.
 */

import { loadEngineCatalog } from '@fusedashlabs/widgets/catalog';

import type { EngineCatalog } from '../spec/engine-catalog.js';

/** The 20 engine-tier entries. Structural — widgets owns the id list. */
export function loadWorkspaceCatalog(): EngineCatalog {
  return loadEngineCatalog().filter((meta) => meta.tier === 'engine');
}

/** Ids only, in catalog order. */
export function workspaceCatalogIds(): string[] {
  return loadWorkspaceCatalog().map((entry) => entry.id);
}
