import { describe, expect, it } from 'vitest';

import { GEOJSON_KEYS as WIDGETS_GEOJSON_KEYS, type RegionKeys as WidgetsRegionKeys } from '../../../vendor/ui9000-widgets/src/components/map-chart/lib/constants.js';
import { GEOJSON_KEYS, type RegionKeys } from './geojsonKeys.js';

const REGION_FIELDS: (keyof RegionKeys)[] = ['name', 'code', 'id', 'county', 'state', 'country'];

function normalizeKeys(keys: Record<string, RegionKeys | WidgetsRegionKeys>): Record<string, RegionKeys> {
  const out: Record<string, RegionKeys> = {};
  for (const mapType of Object.keys(keys).sort()) {
    const row = keys[mapType];
    out[mapType] = {
      name: row.name,
      code: row.code,
      id: row.id,
      county: row.county,
      state: row.state,
      country: row.country,
    };
  }
  return out;
}

describe('GEOJSON_KEYS parity with widgets map-chart (FUS-4088)', () => {
  it('covers the expected map types and RegionKeys fields', () => {
    expect(Object.keys(GEOJSON_KEYS).sort()).toEqual(
      ['city', 'country', 'county', 'province', 'region', 'state'].sort(),
    );
    for (const mapType of Object.keys(GEOJSON_KEYS)) {
      for (const field of REGION_FIELDS) {
        expect(GEOJSON_KEYS[mapType][field], `${mapType}.${field}`).toEqual(expect.any(String));
        expect(GEOJSON_KEYS[mapType][field].length).toBeGreaterThan(0);
      }
    }
  });

  it('fails when a map type exists in only one place', () => {
    const migrateTypes = Object.keys(GEOJSON_KEYS).sort();
    const widgetsTypes = Object.keys(WIDGETS_GEOJSON_KEYS).sort();
    const onlyMigrate = migrateTypes.filter((k) => !widgetsTypes.includes(k));
    const onlyWidgets = widgetsTypes.filter((k) => !migrateTypes.includes(k));
    expect(onlyMigrate, `migrate-only GEOJSON_KEYS: ${onlyMigrate.join(', ') || '(none)'}`).toEqual([]);
    expect(onlyWidgets, `widgets-only GEOJSON_KEYS: ${onlyWidgets.join(', ') || '(none)'}`).toEqual([]);
  });

  it('matches widgets GEOJSON_KEYS field-for-field (do not "fix" drift — report it)', () => {
    expect(normalizeKeys(GEOJSON_KEYS)).toEqual(normalizeKeys(WIDGETS_GEOJSON_KEYS));
  });
});
