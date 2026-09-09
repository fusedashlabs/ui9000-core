/**
 * Catalog argument for validateSpec / decide.
 * Structural — widgets `EngineMetadata[]` is assignable.
 * Do not import `src/catalog` (junior loader) from here.
 */

export type CatalogDataRole = {
  id: string;
  required?: boolean;
};

export type CatalogEntry = {
  id: string;
  dataRoles?: readonly CatalogDataRole[];
  allowedActions?: readonly string[];
  intents?: readonly string[];
  accessibility?: { nameFrom?: string };
};

export type EngineCatalog = readonly CatalogEntry[];
