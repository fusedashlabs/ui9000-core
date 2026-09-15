import { GEOJSON_KEYS } from "./geojsonKeys";

export const getRegionIdFromFeatureProperties = (
  featureProperties: GeoJSON.GeoJsonProperties,
  mapType?: string
) => {
  if (!featureProperties || !mapType) {
    return undefined;
  }

  switch (mapType) {
    case "city":
      return featureProperties?.[GEOJSON_KEYS.city.id];

    case "region":
      return featureProperties?.[GEOJSON_KEYS.region.id];

    case "county":
      return featureProperties?.[GEOJSON_KEYS.county.id];

    case "state":
      return featureProperties?.[GEOJSON_KEYS.state.id];

    case "province":
      return featureProperties?.[GEOJSON_KEYS.province.id];

    case "country": {
      const iso = featureProperties?.[GEOJSON_KEYS.country.id];
      // NE marks disputed territories (Kosovo, Somaliland, N. Cyprus, ...)
      // with iso_a3="-99"; their stable id lives in adm0_a3.
      if (iso === "-99") {
        return featureProperties?.adm0_a3 ?? iso;
      }
      return iso;
    }

    default:
      return undefined;
  }
};
