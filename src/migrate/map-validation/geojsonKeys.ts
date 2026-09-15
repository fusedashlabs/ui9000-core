// Vendored from fusedash-client (libs/shared/.../MapBox/constants.ts). Keep in
// sync with the renderer — the parity test guards behaviour. Maps each map type
// to the GeoJSON feature properties used to build the join keys.
export interface RegionKeys {
  name: string;
  code: string;
  id: string;
  county: string;
  state: string;
  country: string;
}

export const GEOJSON_KEYS: Record<string, RegionKeys> = {
  city: { name: "NAME_2", code: "GID_0", id: "GID_2", county: "NAME_2", state: "NAME_1", country: "COUNTRY" },
  region: { name: "name", code: "iso_3166_2", id: "iso_3166_2", county: "name", state: "name", country: "admin" },
  county: { name: "NAME_2", code: "GID_0", id: "GID_2", county: "NAME_2", state: "NAME_1", country: "COUNTRY" },
  state: { name: "NAME_1", code: "GID_0", id: "GID_1", county: "NAME_2", state: "NAME_1", country: "COUNTRY" },
  country: { name: "name", code: "name", id: "iso_a3", county: "NAME_2", state: "NAME_1", country: "COUNTRY" },
  // Global admin-1 (Natural Earth): join key is the ISO 3166-2 code; `admin` is the country.
  province: { name: "name", code: "iso_3166_2", id: "iso_3166_2", county: "name", state: "name", country: "admin" },
};
