import { GEOJSON_KEYS } from "./geojsonKeys";

import { getRegionIdFromFeatureProperties } from "./getRegionIdFromFeatureProperties";
import { normalizeDataValue } from "./normalizeDataValue";

export type FeaturesIndex = {
  byId: Map<string, GeoJSON.Feature>;
  byDataValue: Map<string, string>;
  byNormalizedValue: Map<string, string>;
};

// Natural Earth admin-0 long forms vs the names datasets actually carry.
// Used to index extra "Country,Unit" composites for admin-1 joins.
const COUNTRY_SYNONYMS: Record<string, string[]> = {
  "United States of America": ["United States", "USA", "US"],
  "United Republic of Tanzania": ["Tanzania"],
  "Hong Kong S.A.R.": ["Hong Kong"],
  "Ivory Coast": ["Côte d'Ivoire", "Cote d'Ivoire"],
  "Cape Verde": ["Cabo Verde"],
  "Republic of the Congo": ["Congo", "Congo-Brazzaville"],
  "Democratic Republic of the Congo": ["DR Congo", "DRC", "Congo (Kinshasa)"],
  "West Bank": ["Palestine", "State of Palestine"],
  "Caribbean Netherlands": ["Netherlands"],
  "The Bahamas": ["Bahamas"],
  "Republic of Serbia": ["Serbia"],
  Macedonia: ["North Macedonia"],
  "East Timor": ["Timor-Leste", "Timor Leste"],
  "Federated States of Micronesia": ["Micronesia"],
  "Guinea Bissau": ["Guinea-Bissau"],
  Swaziland: ["Eswatini"],
  "Czech Republic": ["Czechia"],
  "South Korea": ["Korea, Rep.", "Republic of Korea"],
  "North Korea": ["Korea, North", "DPRK"],
  Burma: ["Myanmar"],
  "United Kingdom": ["UK", "Great Britain"],
};

// Natural Earth `name` is "Czech Rep."; datasets and ISO use "Czechia".
const COUNTRY_LABEL_ALIASES: Record<string, string[]> = {
  "Czech Rep.": ["Czechia", "Czech Republic"],
  "Czech Republic": ["Czechia", "Czech Rep."],
  Czechia: ["Czech Republic", "Czech Rep."],
};

function countryLabelAliases(seeds: unknown[]): string[] {
  const out = new Set<string>();
  for (const seed of seeds) {
    if (typeof seed !== "string" || !seed) continue;
    for (const alias of COUNTRY_LABEL_ALIASES[seed] ?? []) out.add(alias);
  }
  return [...out];
}

/**
 * Creates an index for O(1) lookup instead of O(n) find()
 */
export const createFeaturesIndex = (
  features: GeoJSON.Feature[],
  mapType: string
): FeaturesIndex => {
  const byId = new Map<string, GeoJSON.Feature>();
  const byDataValue = new Map<string, string>();
  const byNormalizedValue = new Map<string, string>();

  if (!features?.length || !mapType) {
    return { byId, byDataValue, byNormalizedValue };
  }

  // Within-country duplicate city names make the 2-part "Country,City" key
  // ambiguous; an arbitrary winner silently colors the wrong unit, so those
  // keys are dropped after indexing (the 3-part form stays authoritative).
  const ambiguousTwoPartKeys = new Set<string>();

  features.forEach((feature) => {
    const regionId = getRegionIdFromFeatureProperties(
      feature.properties,
      mapType
    );

    if (!regionId) return;

    const regionIdStr = String(regionId);
    byId.set(regionIdStr, feature);

    const dataValue = getDataValueFromFeature(feature, mapType);
    if (dataValue) {
      const normalized = normalizeDataValue(dataValue, mapType);
      byDataValue.set(dataValue.toLowerCase(), regionIdStr);
      byNormalizedValue.set(normalized, regionIdStr);

      // For city mapType, also create 2-part format (country,city) for backward compatibility
      if (mapType === "city" && feature.properties) {
        const country = feature.properties.COUNTRY;
        const state = feature.properties.NAME_1; // State/Region name
        const cityName = feature.properties.NAME_2; // City name

        // Add index entry for country,cityName format
        if (country && cityName) {
          const twoPartFormat = `${country},${cityName}`;
          const normalizedTwoPart = normalizeDataValue(twoPartFormat, mapType);
          const existing = byNormalizedValue.get(normalizedTwoPart);
          if (existing && existing !== regionIdStr) {
            ambiguousTwoPartKeys.add(normalizedTwoPart);
          } else {
            byNormalizedValue.set(normalizedTwoPart, regionIdStr);
          }
        }

        // Also add index entry for country,stateName format (for cases like
        // "Romania, Bucharest"). Never let this backfill overwrite a real
        // "Country,City" key — that was silently re-pointing every capital
        // that shares its state's name (Amman, Dakar, Banjul, ...) at a
        // sibling city in the same state.
        if (country && state && state !== cityName) {
          const stateFormat = `${country},${state}`;
          const normalizedState = normalizeDataValue(stateFormat, mapType);
          if (!byNormalizedValue.has(normalizedState)) {
            byNormalizedValue.set(normalizedState, regionIdStr);
          }
        }
      }

      // County rows often arrive as "Country,County" with no state part —
      // e.g. the Romanian counties in the boundary set carry an empty NAME_1,
      // so the 3-part composite can't represent them and they would only be
      // reachable by bare name. Index the 2-part form too; within-country
      // duplicate county names (US has hundreds) make it ambiguous, so those
      // keys are dropped the same way the city block does.
      if (mapType === "county" && feature.properties) {
        const country = feature.properties.COUNTRY;
        const countyName = feature.properties.NAME_2;
        if (country && countyName) {
          const countryForms = [country, ...(COUNTRY_SYNONYMS[country] ?? [])];
          for (const countryForm of countryForms) {
            const twoPartFormat = `${countryForm},${countyName}`;
            const normalizedTwoPart = normalizeDataValue(
              twoPartFormat,
              mapType
            );
            const existing = byNormalizedValue.get(normalizedTwoPart);
            if (existing && existing !== regionIdStr) {
              ambiguousTwoPartKeys.add(normalizedTwoPart);
            } else {
              byNormalizedValue.set(normalizedTwoPart, regionIdStr);
            }
          }
        }
      }

      // Region rows often carry a "Country,Region" composite; index it so a
      // correctly-prefixed value disambiguates same-named admin-1 units.
      if (
        (mapType === "region" || mapType === "province") &&
        feature.properties
      ) {
        const country = feature.properties.admin;
        const regionName = feature.properties.name;
        const unitNames = [
          regionName,
          feature.properties.name_en,
          ...String(feature.properties.aliases ?? "").split("|"),
        ].filter((n): n is string => typeof n === "string" && n.length > 0);
        const countryForms = country
          ? [country, ...(COUNTRY_SYNONYMS[country] ?? [])]
          : [];
        for (const countryForm of countryForms) {
          for (const unitName of unitNames) {
            const composite = normalizeDataValue(
              `${countryForm},${unitName}`,
              mapType
            );
            if (!byNormalizedValue.has(composite)) {
              byNormalizedValue.set(composite, regionIdStr);
            }
          }
        }

        // English names and curated alias lists (e.g. the Romanian
        // historical regions: Moldavia, Transylvania, Transilvanie).
        const aliasValues = [
          feature.properties.name_en,
          ...String(feature.properties.aliases ?? "").split("|"),
        ];
        for (const alias of aliasValues) {
          if (typeof alias !== "string" || !alias || alias === regionName) {
            continue;
          }
          const aliasLower = alias.toLowerCase();
          if (!byDataValue.has(aliasLower)) {
            byDataValue.set(aliasLower, regionIdStr);
          }
          const aliasNorm = normalizeDataValue(alias, mapType);
          if (!byNormalizedValue.has(aliasNorm)) {
            byNormalizedValue.set(aliasNorm, regionIdStr);
          }
        }
      }

      // Generated data often carries the bare unit name without the country
      // prefix the state/province composite index keys on.
      if (
        (mapType === "state" || mapType === "province") &&
        feature.properties
      ) {
        const bareName =
          feature.properties[GEOJSON_KEYS[mapType].state] ??
          feature.properties[GEOJSON_KEYS[mapType].name];
        if (typeof bareName === "string" && bareName) {
          const bareLower = bareName.toLowerCase();
          if (!byDataValue.has(bareLower)) {
            byDataValue.set(bareLower, regionIdStr);
          }
          const bareNorm = normalizeDataValue(bareName, mapType);
          if (!byNormalizedValue.has(bareNorm)) {
            byNormalizedValue.set(bareNorm, regionIdStr);
          }
        }
      }

      // Natural Earth's primary `name` is the short form ("United States"),
      // but datasets often carry the long/formal one ("United States of
      // America"), so index those aliases too.
      if (mapType === "country" && feature.properties) {
        const aliasValues: unknown[] = [
          ...["name_long", "formal_en", "brk_name", "admin", "geounit"].map(
            (key) => feature.properties?.[key]
          ),
          ...String(feature.properties.aliases ?? "").split("|"),
          ...countryLabelAliases([
            dataValue,
            feature.properties.name,
            feature.properties.admin,
            feature.properties.name_long,
            feature.properties.brk_name,
          ]),
        ];
        for (const alias of aliasValues) {
          if (typeof alias === "string" && alias && alias !== dataValue) {
            const aliasLower = alias.toLowerCase();
            if (!byDataValue.has(aliasLower)) {
              byDataValue.set(aliasLower, regionIdStr);
            }
            const aliasNormalized = normalizeDataValue(alias, mapType);
            if (!byNormalizedValue.has(aliasNormalized)) {
              byNormalizedValue.set(aliasNormalized, regionIdStr);
            }
          }
        }
      }
    }
  });

  for (const key of ambiguousTwoPartKeys) {
    byNormalizedValue.delete(key);
  }

  return { byId, byDataValue, byNormalizedValue };
};

const getDataValueFromFeature = (
  feature: GeoJSON.Feature,
  mapType: string
): string | undefined => {
  const props = feature.properties;
  if (!props) return undefined;

  const keys = GEOJSON_KEYS[mapType as keyof typeof GEOJSON_KEYS];
  if (!keys) return undefined;

  const getProp = (key: keyof typeof keys): string | undefined =>
    props[keys[key]] as string | undefined;

  const buildComposite = (
    parts: (keyof typeof keys)[],
    fallbackKey: keyof typeof keys
  ): string | undefined => {
    const values = parts.map(getProp);
    const allPresent = values.every((v) => v != null && v !== "");
    return allPresent ? values.join(",") : getProp(fallbackKey);
  };

  const buildCityComposite = (): string | undefined => {
    const country = getProp("country");
    const state = getProp("state");
    const name = getProp("name");

    // Try full 3-part format: country, state, city
    if (country && state && name) {
      return `${country},${state},${name}`;
    }

    // Try 2-part format: country, city (when state is missing)
    if (country && name) {
      return `${country},${name}`;
    }

    // Fallback to just city name
    return name;
  };

  switch (mapType) {
    case "city":
      return buildCityComposite();
    case "county":
      return buildComposite(["country", "state", "county"], "county");
    case "state":
    case "province":
      // global admin-1: "Country,Province" composite — same pattern as US state
      return buildComposite(["country", "state"], "state");
    case "country":
    case "region":
      return getProp("name");
    default:
      return undefined;
  }
};
