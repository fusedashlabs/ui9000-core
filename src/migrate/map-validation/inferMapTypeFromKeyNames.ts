const MAP_TYPES = ["city", "county", "state", "province", "region", "country"];

// Last-resort map type detection for widgets whose dataset is not in the
// store (e.g. generated configs referencing another project's dataset): the
// geospatial key names themselves carry the admin level (country__created,
// County, region).
export const inferMapTypeFromKeyNames = (
  dataKeys: string[]
): string | undefined => {
  for (const key of dataKeys ?? []) {
    const name = String(key).toLowerCase();
    const found = MAP_TYPES.find((type) => name.includes(type));
    if (found) {
      return found;
    }
  }
  return undefined;
};
