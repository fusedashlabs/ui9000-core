/**
 * ISO-3166 country codes → Natural Earth `name` labels the map-chart join indexes.
 * CSV geo columns are often `FR` / `FRA`; choropleth chat rows join on `France`.
 * Tables are sliced from the same `country.json` catalog the join uses.
 */

import names from './country-iso-names.json';

const ISO2_TO_NAME: Record<string, string> = names.iso2;
const ISO3_TO_NAME: Record<string, string> = names.iso3;

/** Map `FR` / `FRA` / `France` onto the Natural Earth name the choropleth joins. */
export function countryJoinLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const code = trimmed.toUpperCase();
  if (code.length === 2) return ISO2_TO_NAME[code] ?? trimmed;
  if (code.length === 3) return ISO3_TO_NAME[code] ?? trimmed;
  return trimmed;
}
