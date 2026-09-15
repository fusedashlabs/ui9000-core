// Common city name spelling variations - easily extensible
const CITY_NAME_VARIATIONS: Record<string, string> = {
  kyiv: "kiev",
  peking: "beijing",
  bombay: "mumbai",
  calcutta: "kolkata",
  madras: "chennai",
  saigon: "hochiminh",
};

/**
 * Normalizes dataValue for matching based on mapType
 * Handles different normalization rules for city, county, state, country, and region
 */
export const normalizeDataValue = (
  dataValue: string,
  mapType: string
): string => {
  if (!dataValue) return "";

  // Strip diacritics for every type so comma-below vs cedilla (ș/ş, ț/ţ) and
  // accents (São/Sao, Córdoba/Cordoba) match regardless of encoding.
  let normalized = dataValue.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Fold common punctuation variants so "St. Andrew"/"Saint Andrew" and
  // "Guinea-Bissau"/"Guinea Bissau" match across data sources.
  normalized = normalized.replace(/\bst\.?\s+/g, "saint ");
  if (mapType !== "city") {
    normalized = normalized.replace(/['’´\`.-]/g, " ");
  }

  if (mapType === "city") {
    // Remove all special characters, apostrophes, diacritics
    normalized = normalized
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
      .replace(/[''`´]/g, "") // Remove apostrophes and quotes
      .replace(/[-_]/g, ""); // Remove hyphens and underscores

    // Apply common spelling variations
    Object.entries(CITY_NAME_VARIATIONS).forEach(([from, to]) => {
      const regex = new RegExp(`\\b${from}\\b`, "g");
      normalized = normalized.replace(regex, to);
    });
  }

  if (mapType === "country") {
    return normalized;
  }

  const parts = normalized.replace(/ /g, "").split(",");

  if (mapType === "county") {
    return parts.map((item) => item.replace("county", "")).join(",");
  }

  return parts.join(",");
};
