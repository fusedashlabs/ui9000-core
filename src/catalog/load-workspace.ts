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
  return loadEngineCatalog()
    .filter((meta) => meta.tier === 'engine')
    .map((meta) => withEdgeMetric(meta));
}

/**
 * Widgets name the graph ends. Core adds an optional metric so a leftover
 * number (weight, sessions) is the edge value, and validateSpec accepts that bind.
 */
function withEdgeMetric<T extends { id?: string; dataRoles?: readonly { id: string; required?: boolean }[] }>(
  meta: T,
): T {
  if (meta.id !== 'network-graph') return meta;
  const roles = meta.dataRoles ?? [];
  if (roles.some((role) => role.id === 'metric' || role.id === 'y')) return meta;
  return { ...meta, dataRoles: [...roles, { id: 'metric', required: false }] };
}

/** Ids only, in catalog order. */
export function workspaceCatalogIds(): string[] {
  return loadWorkspaceCatalog().map((entry) => entry.id);
}
