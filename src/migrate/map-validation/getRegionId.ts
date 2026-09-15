import { FeaturesIndex } from "./createFeaturesIndex";
import { normalizeDataValue } from "./normalizeDataValue";

/**
 * Optimized version using index for O(1) lookup instead of O(n) find()
 */
export const getRegionIdOptimized = (
  dataValue: string,
  mapType: string,
  index: FeaturesIndex
): string | undefined => {
  if (!dataValue || !mapType) {
    return undefined;
  }

  const directMatch = index.byDataValue.get(dataValue.toLowerCase());
  if (directMatch) {
    return directMatch;
  }

  const normalized = normalizeDataValue(dataValue, mapType);
  const normalizedMatch = index.byNormalizedValue.get(normalized);
  if (normalizedMatch) {
    return normalizedMatch;
  }

  // Generated configs sometimes prefix unit values with a country
  // ("Moldova,Iași") that the boundary set doesn't key on, or gets wrong.
  // Fall back to the bare unit name for the simple-name map types; counties
  // need it too because boundary sets with an empty state property (e.g. the
  // Romanian counties) index those features under the bare county name.
  if (
    (mapType === "region" || mapType === "province" || mapType === "county") &&
    dataValue.includes(",")
  ) {
    const lastPart = dataValue.split(",").at(-1)?.trim();
    if (lastPart) {
      return (
        index.byDataValue.get(lastPart.toLowerCase()) ??
        index.byNormalizedValue.get(normalizeDataValue(lastPart, mapType))
      );
    }
  }

  return undefined;
};
