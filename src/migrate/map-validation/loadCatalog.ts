import cityGeo from "./catalogs/city.json" with { type: "json" };
import countryGeo from "./catalogs/country.json" with { type: "json" };
import countyGeo from "./catalogs/county.json" with { type: "json" };
import provinceGeo from "./catalogs/province.json" with { type: "json" };
import stateGeo from "./catalogs/state.json" with { type: "json" };

// Geometry-free boundary catalogs for every map type the renderer supports.
// region reuses the world-provinces (admin-1) set.
const CATALOGS: Record<string, { features: GeoJSON.Feature[] }> = {
  city: cityGeo as unknown as { features: GeoJSON.Feature[] },
  country: countryGeo as unknown as { features: GeoJSON.Feature[] },
  county: countyGeo as unknown as { features: GeoJSON.Feature[] },
  province: provinceGeo as unknown as { features: GeoJSON.Feature[] },
  region: provinceGeo as unknown as { features: GeoJSON.Feature[] },
  state: stateGeo as unknown as { features: GeoJSON.Feature[] },
};

export const loadCatalog = (mapType: string): GeoJSON.Feature[] => {
  const catalog = CATALOGS[mapType];
  if (!catalog) throw new Error(`No vendored catalog for map type "${mapType}"`);
  return catalog.features;
};
