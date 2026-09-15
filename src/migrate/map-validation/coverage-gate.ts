import type { MapValidation } from './validateMapData.js';

// A map chart whose geospatial values resolve to (almost) no boundaries — the
// field is the wrong admin level, or the values aren't real regions. We refuse
// to sign the data-link and surface the actionable message so the model
// regenerates correctly, instead of MCP silently rewriting the user's data.
export class MapValidationError extends Error {
  readonly mapValidation: MapValidation;
  constructor(mapValidation: MapValidation) {
    super(mapValidation.llmMessage);
    this.name = 'MapValidationError';
    this.mapValidation = mapValidation;
  }
}

// Block only when a layer renders essentially nothing (≤10% of values match),
// not on every partial mismatch — a correctly-typed map that joins most of its
// values must still sign, or the model would loop on the few unmatchable ones.
export const MIN_RENDERABLE_COVERAGE = 0.1;

export const findUnrenderableMap = (
  mapValidation: MapValidation | undefined,
): MapValidation | undefined => {
  if (!mapValidation?.applicable) return undefined;
  const broken = mapValidation.layers.some((l) => l.coverage <= MIN_RENDERABLE_COVERAGE);
  return broken ? mapValidation : undefined;
};

/** Throw when a map layer is at or below the coverage gate — signing must refuse. */
export const assertRenderableMap = (mapValidation: MapValidation | undefined): void => {
  const broken = findUnrenderableMap(mapValidation);
  if (broken) throw new MapValidationError(broken);
};
