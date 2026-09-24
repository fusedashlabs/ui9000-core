import { GEO_LAT_NAMES, GEO_LNG_NAMES } from '../../profiler/roles.js';
import { normalizeName } from '../../profiler/table.js';
import { countryJoinLabel } from '../country-join-label.js';
import { aggregatePoints } from './rows.js';

export function mapChartPayload(
  chartType: string | undefined,
  fields: Record<string, string>,
  rows: Record<string, unknown>[],
): unknown | null {
  const pair = latLngFields(rows[0]!);
  if (pair) {
    const markers: Array<{ point: [number, number]; value: number }> = [];
    for (const row of rows) {
      const lat = Number(row[pair.lat]);
      const lng = Number(row[pair.lng]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const raw = fields.metric ? Number(row[fields.metric]) : 1;
      markers.push({
        point: [lng, lat],
        value: Number.isFinite(raw) ? raw : 1,
      });
    }
    if (markers.length === 0) return null;
    return {
      chartType,
      name: 'map-chart',
      layers: [
        {
          name: 'Markers',
          visualisationType: 'markers',
          geospatialData: ['point'],
          arrangeByMetric: ['value'],
          data: markers,
        },
      ],
    };
  }

  const points = aggregatePoints(
    rows,
    fields.geo ?? fields.category,
    fields.metric,
    countryJoinLabel,
  );
  if (!points) return null;
  return { chartType, name: 'map-chart', data: points };
}

function latLngFields(
  row: Record<string, unknown>,
): { lat: string; lng: string } | null {
  const keys = Object.keys(row);
  const lat = keys.find((key) =>
    (GEO_LAT_NAMES as readonly string[]).includes(normalizeName(key)),
  );
  const lng = keys.find((key) =>
    (GEO_LNG_NAMES as readonly string[]).includes(normalizeName(key)),
  );
  return lat && lng ? { lat, lng } : null;
}
