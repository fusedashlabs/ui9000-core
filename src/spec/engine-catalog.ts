/**
 * Catalog argument for validateSpec / decide.
 * Structural — widgets `EngineMetadata[]` is assignable.
 * Do not import `src/catalog` (junior loader) from here.
 */

import type { DataProfile } from './data-profile.js';
import type { Intent } from './intent.js';

export type CatalogDataRole = {
  id: string;
  required?: boolean;
};

export type CatalogRule = {
  when: string;
  reason: string;
};

export type CatalogEvalCase = {
  id?: string;
  intent?: Intent;
  profile?: DataProfile;
  expect?: 'eligible' | 'disqualified';
  reasonIncludes?: string;
};

export type CatalogEntry = {
  id: string;
  dataRoles?: readonly CatalogDataRole[];
  allowedActions?: readonly string[];
  intents?: readonly string[];
  accessibility?: { nameFrom?: string };
  eligibility?: readonly CatalogRule[];
  disqualify?: readonly CatalogRule[];
  evalCases?: readonly CatalogEvalCase[];
};

export type EngineCatalog = readonly CatalogEntry[];
