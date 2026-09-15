export {
  validateRegions,
  validateMapData,
  resolveMapType,
  isMapConfig,
  type Suggestion,
  type RegionWarning,
  type LayerValidation,
  type MapValidation,
  type LoadCatalog,
} from "./validateMapData.js";
export { loadCatalog } from "./loadCatalog.js";
export { validateChartConfig } from "./validateChart.js";
export { GEOJSON_KEYS, type RegionKeys } from "./geojsonKeys.js";
export {
  MIN_RENDERABLE_COVERAGE,
  MapValidationError,
  assertRenderableMap,
  findUnrenderableMap,
} from "./coverage-gate.js";
