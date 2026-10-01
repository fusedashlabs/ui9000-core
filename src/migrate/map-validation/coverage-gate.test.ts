import { describe, expect, it } from 'vitest';

import {
  MIN_RENDERABLE_COVERAGE,
  MapValidationError,
  assertRenderableMap,
  findUnrenderableMap,
} from './coverage-gate.js';
import { loadCatalog } from './loadCatalog.js';
import { validateChartConfig } from './validateChart.js';
import { validateMapData, type LayerValidation, type MapValidation } from './validateMapData.js';

const layer = (coverage: number): LayerValidation => ({
  applicable: true,
  mapType: 'state',
  geospatialKey: 'state__created',
  mapsCorrectly: coverage === 1,
  coverage,
  matched: [],
  warnings: [],
  unmatched: [],
});

const verdict = (coverage: number): MapValidation => ({
  applicable: true,
  mapsCorrectly: coverage === 1,
  layers: [layer(coverage)],
  llmMessage: 'coverage fixture',
});

describe('≤10% coverage gate (refuses signing)', () => {
  it('keeps the threshold at 0.1', () => {
    expect(MIN_RENDERABLE_COVERAGE).toBe(0.1);
  });

  it('refuses when a layer matches 10% or less', () => {
    expect(findUnrenderableMap(verdict(0))).toBeDefined();
    expect(findUnrenderableMap(verdict(0.1))).toBeDefined();
  });

  it('does not refuse a correctly-typed map that joins most values', () => {
    expect(findUnrenderableMap(verdict(0.11))).toBeUndefined();
    expect(findUnrenderableMap(verdict(1))).toBeUndefined();
  });

  it('does not refuse non-map payloads', () => {
    expect(
      findUnrenderableMap({
        applicable: false,
        mapsCorrectly: true,
        layers: [],
        llmMessage: 'Not a map chart; nothing to validate.',
      }),
    ).toBeUndefined();
  });

  it('throws MapValidationError so signing cannot proceed', () => {
    expect(() => assertRenderableMap(verdict(0))).toThrow(MapValidationError);
    expect(() => assertRenderableMap(verdict(0.11))).not.toThrow();
  });

  it('refuses a real map whose values match nothing', async () => {
    const config = {
      config: {
        type: 'mapChart',
        chartType: 'mapChart',
        layers: [
          {
            geospatialData: ['state__created'],
            data: [{ state__created: 'not-a-region', total: 1 }],
          },
        ],
      },
    };
    const result = await validateMapData(config, loadCatalog);
    expect(result.layers[0].coverage).toBe(0);
    expect(findUnrenderableMap(result)).toBe(result);
    expect(() => assertRenderableMap(result)).toThrow(MapValidationError);

    const viaChart = await validateChartConfig(config.config);
    expect(() => assertRenderableMap(viaChart)).toThrow(MapValidationError);
  });

  it('checks a choropleth whose rows were renamed to label', async () => {
    const choropleth = {
      chartType: 'mapChart',
      layers: [
        {
          visualisationType: 'choropleth',
          geospatialData: ['label'],
          data: [{ label: 'France', value: 1 }],
        },
      ],
    };
    const skipped = await validateChartConfig(choropleth);
    expect(findUnrenderableMap(skipped)).toBe(skipped);
    const checked = await validateChartConfig(choropleth, { mapType: 'country' });
    expect(findUnrenderableMap(checked)).toBeUndefined();
  });

  it('honours mapType on the layer the widget reads', async () => {
    const state = await validateChartConfig({
      chartType: 'mapChart',
      layers: [
        {
          visualisationType: 'choropleth',
          mapType: 'state',
          geospatialData: ['label'],
          data: [{ label: 'California', value: 1 }],
        },
      ],
    });
    expect(state?.layers[0]?.mapType).toBe('state');
    expect(findUnrenderableMap(state)).toBeUndefined();

    const asCountry = await validateChartConfig({
      chartType: 'mapChart',
      layers: [
        {
          visualisationType: 'choropleth',
          mapType: 'country',
          geospatialData: ['label'],
          data: [{ label: 'France', value: 1 }],
        },
      ],
    });
    expect(findUnrenderableMap(asCountry)).toBeUndefined();
  });

  it('does not refuse a marker layer', async () => {
    const verdict = await validateChartConfig({
      chartType: 'mapChart',
      layers: [
        {
          visualisationType: 'markers',
          geospatialData: ['point'],
          data: [{ point: [2.3, 48.8], value: 1 }],
        },
      ],
    });
    expect(findUnrenderableMap(verdict)).toBeUndefined();
  });

  it('throws when the catalog is missing instead of looking like a pass', async () => {
    await expect(
      validateChartConfig(
        {
          chartType: 'mapChart',
          layers: [{ geospatialData: ['label'], data: [{ label: 'France' }] }],
        },
        { mapType: 'nope' },
      ),
    ).rejects.toThrow(/catalog/);
  });
});
