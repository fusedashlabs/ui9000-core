/**
 * Column → role classification.
 *
 * Every column gets at most one role, first match wins, in the precedence
 * below. One role per column is what keeps a profile reproducible: `lat` is
 * geo and never also a numeric metric, `year` is temporal and never a metric.
 *
 * Roles are named after the catalog `dataRoles` ids they feed (geo, metric,
 * category, nodes, links, events, claim, sources, entity). Nothing here maps
 * to a DataProfile field that does not exist — see spec/data-profile.ts.
 */

import { normalizeName, type Table, type TableColumn } from './table.js';

export type ColumnRole =
  | 'link'
  | 'node'
  | 'geo'
  | 'temporal'
  | 'entity'
  | 'claim'
  | 'sources'
  | 'event'
  | 'control'
  | 'label'
  | 'metric'
  | 'category'
  | 'empty';

/** Link endpoints are only links in pairs: a lone `source` is a citation. */
const LINK_PAIRS: readonly (readonly [string, string])[] = [
  ['source', 'target'],
  ['from', 'to'],
  ['src', 'dst'],
];

const NODE_NAMES = ['node', 'nodes', 'nodeid'];
/** Shared with widget-payload lat/lng marker detection. */
export const GEO_LAT_NAMES = ['lat', 'latitude'] as const;
export const GEO_LNG_NAMES = ['lng', 'lon', 'long', 'longitude'] as const;
/** Region ids that join to GeoJSON / PMTiles, per map-chart's geo dataRole. */
const REGION_NAMES = [
  'country',
  'countrycode',
  'state',
  'province',
  'region',
  'county',
  'city',
  'geo',
  'geoid',
  'postcode',
  'zip',
];
const TEMPORAL_NAMES = [
  'date',
  'time',
  'datetime',
  'ts',
  'timestamp',
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'period',
  'createdat',
  'updatedat',
  'occurredat',
];
const ENTITY_NAMES = ['id', 'entityid', 'entity', 'uid', 'uuid', 'recordid'];
const CLAIM_NAMES = ['claim', 'claims', 'assertion', 'statement'];
const SOURCE_NAMES = ['source', 'sources', 'citation', 'citations', 'reference', 'references'];
const EVENT_NAMES = ['event', 'events', 'eventtype', 'activity', 'action', 'milestone'];
/** A control table describes form controls, one per row — not dataset rows. */
const CONTROL_NAMES = ['control', 'controls'];
const LABEL_NAMES = ['label', 'labels', 'title', 'caption'];

const NUMBER_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export type ClassifiedColumn = {
  column: TableColumn;
  key: string;
  role: ColumnRole;
};

export type Classification = {
  columns: readonly ClassifiedColumn[];
  /** True when the table describes form controls rather than dataset rows. */
  isControlTable: boolean;
};

export function classifyColumns(table: Table): Classification {
  const keys = table.columns.map((column) => normalizeName(column.name));
  const present = new Set(keys);
  const isControlTable = keys.some((key) => CONTROL_NAMES.includes(key));

  const columns = table.columns.map((column, index) => ({
    column,
    key: keys[index],
    role: isControlTable ? controlRoleOf(keys[index]) : dataRoleOf(keys[index], column, present),
  }));

  return { columns, isControlTable };
}

function controlRoleOf(key: string): ColumnRole {
  if (CONTROL_NAMES.includes(key)) return 'control';
  if (LABEL_NAMES.includes(key)) return 'label';
  return 'empty';
}

function dataRoleOf(key: string, column: TableColumn, present: ReadonlySet<string>): ColumnRole {
  if (isLinkEndpoint(key, present)) return 'link';
  if (NODE_NAMES.includes(key)) return 'node';
  if (isGeo(key, present)) return 'geo';
  if (isTemporal(key, column)) return 'temporal';
  if (ENTITY_NAMES.includes(key) && hasUniqueValues(column)) return 'entity';
  if (CLAIM_NAMES.includes(key)) return 'claim';
  if (SOURCE_NAMES.includes(key)) return 'sources';
  if (EVENT_NAMES.includes(key)) return 'event';
  if (isNumeric(column)) return 'metric';
  if (filled(column).length > 0) return 'category';
  return 'empty';
}

function isLinkEndpoint(key: string, present: ReadonlySet<string>): boolean {
  return LINK_PAIRS.some(
    ([from, to]) => (key === from || key === to) && present.has(from) && present.has(to),
  );
}

function isGeo(key: string, present: ReadonlySet<string>): boolean {
  if (REGION_NAMES.includes(key)) return true;
  const hasPair =
    GEO_LAT_NAMES.some((n) => present.has(n)) && GEO_LNG_NAMES.some((n) => present.has(n));
  return (
    hasPair &&
    ((GEO_LAT_NAMES as readonly string[]).includes(key) ||
      (GEO_LNG_NAMES as readonly string[]).includes(key))
  );
}

/** A header hint, or values that are all ISO 8601 — never a bare number column. */
function isTemporal(key: string, column: TableColumn): boolean {
  if (TEMPORAL_NAMES.includes(key)) return true;
  const values = filled(column);
  return values.length > 0 && values.every((value) => ISO_DATE_PATTERN.test(value));
}

function isNumeric(column: TableColumn): boolean {
  const values = filled(column);
  return (
    values.length > 0 &&
    values.every((value) => NUMBER_PATTERN.test(value) && Number.isFinite(Number(value)))
  );
}

function hasUniqueValues(column: TableColumn): boolean {
  const values = filled(column);
  return values.length > 0 && new Set(values).size === values.length;
}

/** Non-empty cells, trimmed. Blank cells never carry a signal. */
export function filled(column: TableColumn): string[] {
  const values: string[] = [];
  for (const value of column.values) {
    const text = value.trim();
    if (text !== '') values.push(text);
  }
  return values;
}

export function distinctCount(column: TableColumn): number {
  return new Set(filled(column)).size;
}
