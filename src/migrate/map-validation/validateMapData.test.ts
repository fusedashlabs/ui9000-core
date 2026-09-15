import { describe, expect, it } from "vitest";

import { loadCatalog } from "./loadCatalog.js";
import { validateChartConfig } from "./validateChart.js";
import { resolveMapType, validateMapData, validateRegions } from "./validateMapData.js";

// The two real generated data-links: geospatial key "state__created" (so the map
// type resolves to "state"), but the values are Romanian counties.
const US_PREFIXED_RO_COUNTIES = [
  "United States,Covasna",
  "United States,Gorj",
  "United States,Suceava",
  "United States,Hunedoara",
  "United States,Botosani",
];

const realConfig = {
  config: {
    type: "mapChart",
    chartType: "mapChart",
    layers: [
      {
        geospatialData: ["state__created"],
        data: US_PREFIXED_RO_COUNTIES.map((v) => ({ state__created: v, totalStockMTCO2: 1 })),
      },
    ],
  },
};

describe("resolveMapType (faithful to the renderer's getMapType)", () => {
  it("infers 'state' from a 'state__created' key when no explicit type/dataset is given", () => {
    expect(resolveMapType(["state__created"])).toBe("state");
  });
  it("honours an explicit map type", () => {
    expect(resolveMapType(["state__created"], { mapType: "county" })).toBe("county");
  });
});

describe("validateMapData — the real data-link (root cause)", () => {
  it("resolves to 'state', flags the values as counties, and suggests the fix", async () => {
    const result = await validateMapData(realConfig, loadCatalog);

    expect(result.applicable).toBe(true);
    expect(result.mapsCorrectly).toBe(false);
    expect(result.layers[0].mapType).toBe("state");
    expect(result.layers[0].unmatched).toHaveLength(5);
    expect(result.layers[0].unmatched[0]).toEqual({
      value: "United States,Covasna",
      didYouMean: { mapType: "county", value: "Romania,Covasna" },
    });
    expect(result.llmMessage).toContain('map type "county"');
    expect(result.llmMessage).toContain('"Romania,Covasna"');
  });

  it("is correct (renders, warns on wrong country) when the caller passes the right map type", async () => {
    const result = await validateMapData(realConfig, loadCatalog, { mapType: "county" });
    expect(result.mapsCorrectly).toBe(true);
    expect(result.layers[0].mapType).toBe("county");
    expect(result.layers[0].warnings).toHaveLength(5);
    expect(result.layers[0].warnings[0]).toMatchObject({
      type: "countryMismatch",
      actualCountry: "Romania",
      didYouMean: "Romania,Covasna",
    });
  });
});

// A generated data-link with key "country__created" (so the map type resolves to
// "country") but values that are Egyptian governorates in "Country,Unit" form.
// Their primary boundary name is non-Latin (Cairo = "Al Qahirah"), so the
// suggestion must lean on name_en and the "Egypt," prefix — a bare name-only
// lookup picked the wrong country (US "Alexandria") and produced a useless
// generic message.
const EGYPT_GOVERNORATES_AS_COUNTRY = {
  config: {
    type: "mapChart",
    chartType: "mapChart",
    layers: [
      {
        geospatialData: ["country__created"],
        data: [
          "Egypt,Cairo",
          "Egypt,Alexandria",
          "Egypt,Giza",
          "Egypt,Luxor",
          "Egypt,Aswan",
          "Egypt,Ismailia",
          "Egypt,Port Said",
          "Egypt,Suez",
        ].map((v) => ({ country__created: v, population: 1 })),
      },
    ],
  },
};

describe("validateMapData — country-prefixed governorates mislabelled as country", () => {
  it("resolves every value to its Egyptian province via name_en and the country prefix", async () => {
    const result = await validateMapData(EGYPT_GOVERNORATES_AS_COUNTRY, loadCatalog);

    expect(result.mapsCorrectly).toBe(false);
    expect(result.layers[0].mapType).toBe("country");
    const suggestedTypes = new Set(result.layers[0].unmatched.map((u) => u.didYouMean?.mapType));
    expect([...suggestedTypes]).toEqual(["province"]);
    // The country prefix must disambiguate: "Egypt,Alexandria" is the Egyptian
    // governorate, never the US "Alexandria" a bare-name fallback would hit.
    const alex = result.layers[0].unmatched.find((u) => u.value === "Egypt,Alexandria");
    expect(alex?.didYouMean).toEqual({ mapType: "province", value: "Egypt,Alexandria" });
    expect(result.llmMessage).toContain('use map type "province"');
  });

  it("renders correctly once the caller passes the right map type", async () => {
    const result = await validateMapData(EGYPT_GOVERNORATES_AS_COUNTRY, loadCatalog, { mapType: "province" });
    expect(result.mapsCorrectly).toBe(true);
    expect(result.layers[0].mapType).toBe("province");
  });
});

describe("validateRegions", () => {
  it("matches counties via fallback and warns on the wrong country", () => {
    const r = validateRegions(US_PREFIXED_RO_COUNTIES, "county", loadCatalog("county"));
    expect(r.mapsCorrectly).toBe(true);
    expect(r.matched.find((m) => m.value === "United States,Covasna")?.regionId).toBe("RO.1_18");
    expect(r.warnings).toHaveLength(5);
  });

  it("matches a correct country-level value", () => {
    const r = validateRegions(["Romania", "France"], "country", loadCatalog("country"));
    expect(r.mapsCorrectly).toBe(true);
    expect(r.matched).toHaveLength(2);
  });

  it("matches Czechia against Natural Earth Czech Rep.", () => {
    const r = validateRegions(["Czechia", "Germany", "Moldova"], "country", loadCatalog("country"));
    expect(r.unmatched).toEqual([]);
    expect(r.matched.find((m) => m.value === "Czechia")?.regionId).toBe("CZE");
  });
});

describe("validateChartConfig (integration wrapper)", () => {
  it("returns the verdict for a map chart", async () => {
    const v = await validateChartConfig(realConfig.config);
    expect(v?.mapsCorrectly).toBe(false);
    expect(v?.llmMessage).toContain('map type "county"');
  });
  it("returns undefined for a non-map chart", async () => {
    expect(await validateChartConfig({ chartType: "barChart", layers: [] })).toBeUndefined();
  });
});
