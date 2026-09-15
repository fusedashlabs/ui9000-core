import { GEOJSON_KEYS } from "./geojsonKeys";
import { createFeaturesIndex, type FeaturesIndex } from "./createFeaturesIndex";
import { getRegionIdOptimized } from "./getRegionId";
import { inferMapTypeFromKeyNames } from "./inferMapTypeFromKeyNames";
import { normalizeDataValue } from "./normalizeDataValue";

// Headless, framework-free validation that a map widget's geospatial values
// resolve against the boundary set the renderer would actually join them to.
// It reuses the EXACT matching the renderer uses (createFeaturesIndex +
// getRegionIdOptimized + normalizeDataValue) and resolves the map type the same
// way getMapType() does, so "validates" can never drift from "renders". No LLM,
// no network — index lookups against geometry-free region catalogs. Meant to gate
// generated configs before a data-link is signed.

const MAP_TYPES = ["city", "county", "state", "province", "region", "country"] as const;
// Catalogs we can cross-check a stray value against to suggest the right map type.
const SUGGEST_ORDER = ["county", "province", "state", "country", "city"] as const;

export interface Suggestion {
  mapType: string;
  value: string;
}

export interface RegionWarning {
  value: string;
  type: "countryMismatch";
  dataCountry: string;
  actualCountry: string;
  didYouMean: string;
}

export interface LayerValidation {
  applicable: true;
  mapType: string;
  geospatialKey: string;
  mapsCorrectly: boolean;
  coverage: number;
  matched: { value: string; regionId: string }[];
  warnings: RegionWarning[];
  unmatched: { value: string; didYouMean: Suggestion | null }[];
}

export interface MapValidation {
  applicable: boolean;
  mapsCorrectly: boolean;
  layers: LayerValidation[];
  llmMessage: string;
}

export type LoadCatalog = (mapType: string) => Promise<GeoJSON.Feature[]> | GeoJSON.Feature[];

const COUNTRY_EQUIV: string[][] = [
  ["United States of America", "United States", "USA", "US"],
  ["United Kingdom", "UK", "Great Britain"],
];
const normCountry = (c: string): string => normalizeDataValue(String(c ?? ""), "country");
const sameCountry = (a: string, b: string): boolean => {
  if (normCountry(a) === normCountry(b)) return true;
  return COUNTRY_EQUIV.some((group) => {
    const n = group.map(normCountry);
    return n.includes(normCountry(a)) && n.includes(normCountry(b));
  });
};

const featProp = (f: GeoJSON.Feature, mapType: string, key: "country" | "name" | "id"): string =>
  String(f.properties?.[GEOJSON_KEYS[mapType]?.[key]] ?? "");

// The value to hand back as the suggestion: the canonical "Country,Name". Prefer
// the English name (name_en) when the primary name is non-Latin — Egypt's
// governorates carry name="Al Qahirah" but name_en="Cairo", and the data labels
// are English — so the suggestion reads back what the user actually typed.
const canonicalValue = (f: GeoJSON.Feature | undefined, mapType: string): string => {
  if (!f) return "";
  const country = featProp(f, mapType, "country");
  const nameEn = String(f.properties?.name_en ?? "");
  const name = nameEn || featProp(f, mapType, "name");
  return country && name ? `${country},${name}` : name;
};

const dataCountryOf = (value: string): string =>
  value.includes(",") ? value.split(",").slice(0, -1).join(",").trim() : "";

/**
 * Resolve the map type exactly like the renderer's getMapType(): an explicit type
 * wins; otherwise the dataset field subtype (when the caller knows it), then the
 * self-describing geospatial key names. Generated data-links carry neither an
 * explicit type nor dataset metadata, so they fall to key-name inference — which
 * is precisely how a "state__created" key holding county values ends up resolving
 * to "state" and failing to render.
 */
export const resolveMapType = (
  geospatialData: string[],
  opts: { mapType?: string; fieldSubtype?: string } = {},
): string => {
  if (opts.mapType) return opts.mapType;
  if (opts.fieldSubtype && (MAP_TYPES as readonly string[]).includes(opts.fieldSubtype)) {
    return opts.fieldSubtype;
  }
  return inferMapTypeFromKeyNames(geospatialData) ?? "";
};

/**
 * Validate values against pre-loaded boundary features for one resolved map type.
 * Pure: pass the same features (geometry-free is fine) the renderer would load.
 */
export const validateRegions = (
  values: string[],
  mapType: string,
  features: GeoJSON.Feature[],
): LayerValidation => {
  const index = createFeaturesIndex(features, mapType);
  const matched: LayerValidation["matched"] = [];
  const warnings: RegionWarning[] = [];
  const unmatched: LayerValidation["unmatched"] = [];

  for (const value of values) {
    const regionId = getRegionIdOptimized(value, mapType, index);
    if (!regionId) {
      unmatched.push({ value, didYouMean: null });
      continue;
    }
    matched.push({ value, regionId });

    if (value.includes(",")) {
      const f = index.byId.get(regionId);
      const actualCountry = f ? featProp(f, mapType, "country") : "";
      const dataCountry = dataCountryOf(value);
      const regionName = f ? featProp(f, mapType, "name") : "";
      if (dataCountry && actualCountry && !sameCountry(dataCountry, actualCountry)) {
        warnings.push({
          value,
          type: "countryMismatch",
          dataCountry,
          actualCountry,
          didYouMean: `${actualCountry},${regionName}`,
        });
      }
    }
  }

  return {
    applicable: true,
    mapType,
    geospatialKey: "",
    mapsCorrectly: unmatched.length === 0,
    coverage: values.length ? matched.length / values.length : 1,
    matched,
    warnings,
    unmatched,
  };
};

interface RawLayer {
  data?: Record<string, unknown>[];
  geospatialData?: string[];
  mapType?: string;
  fieldSubtype?: string;
  representation?: { geospatial_data?: string[] };
}

const unwrap = (config: unknown): Record<string, unknown> => {
  const c = config as Record<string, unknown>;
  return (c?.config as Record<string, unknown>) ?? c ?? {};
};

export const isMapConfig = (config: unknown): boolean => {
  const cfg = unwrap(config);
  return cfg.chartType === "mapChart" || cfg.type === "mapChart";
};

const layerInputs = (
  layer: RawLayer,
  opts: { mapType?: string; fieldSubtype?: string },
): { mapType: string; geospatialKey: string; values: string[] } => {
  const geospatialKey = layer.geospatialData?.[0] ?? layer.representation?.geospatial_data?.[0] ?? "";
  const mapType = resolveMapType([geospatialKey, ...(layer.geospatialData ?? [])], {
    mapType: opts.mapType ?? layer.mapType,
    fieldSubtype: opts.fieldSubtype ?? layer.fieldSubtype,
  });
  const values = (layer.data ?? [])
    .map((row) => String(row[geospatialKey] ?? "").trim())
    .filter((v) => v.length > 0);
  return { mapType, geospatialKey, values };
};

// Cross-check a stray value against the OTHER catalogs to name the map type it
// actually belongs to (e.g. a value that fails "state" but is a known county).
//
// Match with the renderer's own machinery (createFeaturesIndex +
// getRegionIdOptimized) on the FULL value, not a bare name-only lookup. That
// buys two things the old buildNameIndex couldn't: the country prefix already
// in the value disambiguates same-named places across countries, and name_en /
// alias indexing finds units whose primary name is non-Latin. Two passes: first
// honour a match whose country agrees with the data's prefix ("Egypt,Alexandria"
// is an Egyptian governorate, not the US "Alexandria" a bare match would hit);
// only if none agrees fall back to any match, so a value carrying a simply-wrong
// country prefix still gets corrected ("United States,Covasna" -> Romanian county).
const suggestAcrossTypes = async (
  value: string,
  resolvedType: string,
  loadCatalog: LoadCatalog,
  cache: Map<string, FeaturesIndex>,
): Promise<Suggestion | null> => {
  const dataCountry = dataCountryOf(value);

  const getIndex = async (candidate: string): Promise<FeaturesIndex> => {
    let index = cache.get(candidate);
    if (!index) {
      try {
        index = createFeaturesIndex(await loadCatalog(candidate), candidate);
      } catch {
        index = createFeaturesIndex([], candidate);
      }
      cache.set(candidate, index);
    }
    return index;
  };

  let firstAnyMatch: Suggestion | null = null;
  for (const candidate of SUGGEST_ORDER) {
    if (candidate === resolvedType) continue;
    const index = await getIndex(candidate);
    const regionId = getRegionIdOptimized(value, candidate, index);
    if (!regionId) continue;

    const feature = index.byId.get(regionId);
    const suggestion: Suggestion = { mapType: candidate, value: canonicalValue(feature, candidate) || value };

    const featCountry = feature ? featProp(feature, candidate, "country") : "";
    const countryAgrees = !dataCountry || !featCountry || sameCountry(dataCountry, featCountry);
    if (countryAgrees) return suggestion;
    if (!firstAnyMatch) firstAnyMatch = suggestion;
  }
  return firstAnyMatch;
};

const buildLlmMessage = (layers: LayerValidation[]): string => {
  const unmatched = layers.flatMap((l) => l.unmatched);
  const warnings = layers.flatMap((l) => l.warnings);

  if (unmatched.length) {
    // When a strict majority of the stray values point at one other map type,
    // the diagnosis is a wrong map type, not unknown regions — name it precisely
    // and list the exceptions (a different admin level, or a value that matches
    // nothing) separately, so a few strays don't mask the dominant signal.
    const resolved = new Set(layers.filter((l) => l.unmatched.length).map((l) => l.mapType));
    const tally = new Map<string, number>();
    for (const u of unmatched) {
      if (u.didYouMean) tally.set(u.didYouMean.mapType, (tally.get(u.didYouMean.mapType) ?? 0) + 1);
    }
    const [dominantType, dominantCount] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

    if (dominantType && resolved.size === 1 && dominantCount > unmatched.length / 2) {
      const have = [...resolved][0];
      const ex = unmatched.find((u) => u.didYouMean?.mapType === dominantType)!;
      const exceptions = unmatched.filter((u) => u.didYouMean?.mapType !== dominantType);
      const tail = exceptions.length
        ? ` ${exceptions.length} other value(s) are not ${dominantType}s (${exceptions
            .slice(0, 10)
            .map((u) => `"${u.value}"${u.didYouMean ? ` is a ${u.didYouMean.mapType}` : " matches no boundary"}`)
            .join("; ")}); fix or remove them.`
        : "";
      return `Map will not render: the data resolves to map type "${have}", but ${dominantCount} of ${unmatched.length} value(s) are ${dominantType}s (e.g. "${ex.value}" → use map type "${dominantType}", value "${ex.didYouMean!.value}"). Set the map type to "${dominantType}" or fix the geospatial values.${tail}`;
    }

    const list = unmatched
      .slice(0, 10)
      .map((u) => `"${u.value}"${u.didYouMean ? ` → ${u.didYouMean.mapType} "${u.didYouMean.value}"` : ""}`)
      .join("; ");
    return `Map will not fully render: ${unmatched.length} value(s) do not match the boundaries (${list}). Fix or remove them; do not invent locations.`;
  }

  if (warnings.length) {
    const list = warnings
      .slice(0, 10)
      .map((w) => `"${w.value}" is actually in ${w.actualCountry} (use "${w.didYouMean}")`)
      .join("; ");
    return `Map renders, but ${warnings.length} value(s) carry the wrong country prefix: ${list}. Set the correct country to avoid ambiguous matches.`;
  }

  return "All regions match the map boundaries.";
};

/**
 * Validate a whole chart config (data-link payload or raw config). `loadCatalog`
 * supplies geometry-free boundary features for a map type — the caller owns I/O
 * (vendored JSON import, fs read…), keeping this pure. Pass `opts.mapType` or
 * `opts.fieldSubtype` when the caller already knows them (the MCP does at
 * generation time) for a fully faithful resolution.
 */
export const validateMapData = async (
  config: unknown,
  loadCatalog: LoadCatalog,
  opts: { mapType?: string; fieldSubtype?: string } = {},
): Promise<MapValidation> => {
  if (!isMapConfig(config)) {
    return { applicable: false, mapsCorrectly: true, layers: [], llmMessage: "Not a map chart; nothing to validate." };
  }

  const rawLayers = (unwrap(config).layers as RawLayer[] | undefined) ?? [];
  const suggestionCache = new Map<string, FeaturesIndex>();
  const layers: LayerValidation[] = [];

  for (const layer of rawLayers) {
    const { mapType, geospatialKey, values } = layerInputs(layer, opts);
    if (!mapType || !geospatialKey || values.length === 0) continue;

    const features = await loadCatalog(mapType);
    const result = validateRegions(values, mapType, features);
    result.geospatialKey = geospatialKey;

    for (const u of result.unmatched) {
      u.didYouMean = await suggestAcrossTypes(u.value, mapType, loadCatalog, suggestionCache);
    }
    layers.push(result);
  }

  const mapsCorrectly = layers.every((l) => l.mapsCorrectly);
  return { applicable: true, mapsCorrectly, layers, llmMessage: buildLlmMessage(layers) };
};
