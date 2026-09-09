/**
 * Closed DataProfile — same keys as `@fusedashlabs/widgets` catalog.
 * evalCases.profile and `when` strings may use only these fields.
 * Unknown keys are a test failure. Do not add fields here.
 */

export const DATA_PROFILE_KEYS = [
  'hasCategory',
  'hasNumericMetric',
  'categoryCardinality',
  'hasGeo',
  'hasTemporal',
  'hasNodes',
  'hasLinks',
  'hasTabularRows',
  'rowCount',
  'hasEntityId',
  'hasClaim',
  'hasEvents',
  'controlCount',
  'allControlsLabelled',
  'hasMapToken',
] as const;

export type DataProfileKey = (typeof DATA_PROFILE_KEYS)[number];

export type DataProfile = {
  hasCategory?: boolean;
  hasNumericMetric?: boolean;
  categoryCardinality?: number;
  hasGeo?: boolean;
  hasTemporal?: boolean;
  hasNodes?: boolean;
  hasLinks?: boolean;
  hasTabularRows?: boolean;
  rowCount?: number;
  hasEntityId?: boolean;
  hasClaim?: boolean;
  hasEvents?: boolean;
  controlCount?: number;
  allControlsLabelled?: boolean;
  hasMapToken?: boolean;
};
