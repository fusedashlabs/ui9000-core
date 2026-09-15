import { loadCatalog } from "./loadCatalog.js";
import { isMapConfig, validateMapData, type MapValidation } from "./validateMapData.js";

/**
 * Best-effort map validation for a chart payload's `config`, before a data-link
 * is signed. Never throws — validation must not break data-link creation.
 *
 * The map type is resolved exactly like the renderer's getMapType(): generated
 * data-links carry no explicit type or dataset metadata, so it falls to the
 * geospatial key names (e.g. a "state__created" key holding county values resolves
 * to "state"). Pass `opts.mapType` / `opts.fieldSubtype` when the MCP already
 * knows them for a fully faithful resolution.
 */
export const validateChartConfig = async (
  config: unknown,
  opts: { mapType?: string; fieldSubtype?: string } = {},
): Promise<MapValidation | undefined> => {
  try {
    if (!isMapConfig(config)) return undefined;
    const result = await validateMapData(config, loadCatalog, opts);
    return result.applicable ? result : undefined;
  } catch {
    return undefined;
  }
};
