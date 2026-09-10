/**
 * Table columns → the closed DataProfile.
 *
 * The profiler reports facts; the catalog judges them. There is no threshold
 * here — `categoryCardinality` is a count, and rules like bar-chart's
 * `categoryCardinality <= 30` live in metadata, not in this file.
 *
 * Output carries all 15 DATA_PROFILE_KEYS, in the frozen order, every time:
 * the same table always serializes to the same bytes. Anything the columns do
 * not support is `false` / `0`, never a missing key and never a new key.
 */

import { DATA_PROFILE_KEYS, type DataProfile } from '../spec/data-profile.js';
import { classifyColumns, distinctCount, type ClassifiedColumn } from './roles.js';
import { tableRowCount, type Table } from './table.js';

const PROFILE_KEY_SET = new Set<string>(DATA_PROFILE_KEYS);

/**
 * Host capabilities that no column can prove. A Mapbox token is injected by
 * the host, so it is passed in rather than guessed from a lat/lng pair.
 */
export type ProfileEnv = {
  hasMapToken?: boolean;
};

export function profileColumns(table: Table, env: ProfileEnv = {}): DataProfile {
  const { columns, isControlTable } = classifyColumns(table);
  const rowCount = tableRowCount(table);
  const controls = countControls(columns, isControlTable);

  const category = columns.find((entry) => entry.role === 'category');
  const hasLinks = has(columns, 'link');
  const hasTemporal = has(columns, 'temporal');

  const facts: Required<DataProfile> = {
    hasCategory: category !== undefined,
    hasNumericMetric: has(columns, 'metric'),
    categoryCardinality: category ? distinctCount(category.column) : 0,
    hasGeo: has(columns, 'geo'),
    hasTemporal,
    // Link endpoints are nodes, so a link table is a node table.
    hasNodes: has(columns, 'node') || hasLinks,
    hasLinks,
    // A control table describes controls, not dataset rows.
    hasTabularRows: !isControlTable && rowCount >= 1 && table.columns.length >= 1,
    rowCount,
    hasEntityId: has(columns, 'entity'),
    hasClaim: has(columns, 'claim'),
    // event-timeline needs both; an event column with no clock is not a timeline.
    hasEvents: has(columns, 'event') && hasTemporal,
    controlCount: controls.count,
    allControlsLabelled: controls.allLabelled,
    hasMapToken: env.hasMapToken === true,
  };

  const profile: DataProfile = {};
  for (const key of DATA_PROFILE_KEYS) {
    (profile as Record<string, unknown>)[key] = facts[key];
  }
  assertClosedProfile(profile);
  return profile;
}

/**
 * Guard for anything claiming to be a DataProfile — profiler output and
 * fixtures alike. An extra key fails; it is never dropped and never ignored.
 */
export function assertClosedProfile(profile: object, label = 'profile'): void {
  for (const key of Object.keys(profile)) {
    if (!PROFILE_KEY_SET.has(key)) {
      throw new Error(`${label} has unknown DataProfile key "${key}"`);
    }
  }
}

function has(columns: readonly ClassifiedColumn[], role: ClassifiedColumn['role']): boolean {
  return columns.some((entry) => entry.role === role);
}

/**
 * Controls come from a control table: one control per row, named by the
 * `control` column and named for a screen reader by the `label` column.
 *
 * With no controls `allControlsLabelled` is false, not vacuously true — the
 * `form` entry disqualifies only on `!allControlsLabelled`, so a vacuous true
 * would make a form eligible for every dataset that has no controls at all.
 */
function countControls(
  columns: readonly ClassifiedColumn[],
  isControlTable: boolean,
): { count: number; allLabelled: boolean } {
  if (!isControlTable) return { count: 0, allLabelled: false };

  const controlColumn = columns.find((entry) => entry.role === 'control')?.column;
  const labelColumn = columns.find((entry) => entry.role === 'label')?.column;
  if (!controlColumn) return { count: 0, allLabelled: false };

  let count = 0;
  let labelled = 0;
  for (const [index, value] of controlColumn.values.entries()) {
    if (value.trim() === '') continue;
    count += 1;
    if ((labelColumn?.values[index] ?? '').trim() !== '') labelled += 1;
  }

  return { count, allLabelled: count > 0 && labelled === count };
}
