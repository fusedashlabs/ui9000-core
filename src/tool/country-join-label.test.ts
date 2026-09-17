import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { countryJoinLabel } from './country-join-label.js';

const COUNTRY_CATALOG = fileURLToPath(
  new URL('../migrate/map-validation/catalogs/country.json', import.meta.url),
);

describe('countryJoinLabel', () => {
  it('maps ISO-2 and ISO-3 onto Natural Earth names', () => {
    expect(countryJoinLabel('FR')).toBe('France');
    expect(countryJoinLabel('fra')).toBe('France');
    expect(countryJoinLabel('DE')).toBe('Germany');
    expect(countryJoinLabel('Italy')).toBe('Italy');
    expect(countryJoinLabel('CG')).toBe('Congo');
    expect(countryJoinLabel('CI')).toBe("Côte d'Ivoire");
    expect(countryJoinLabel('CD')).toBe('Dem. Rep. Congo');
    expect(countryJoinLabel('KR')).toBe('Korea');
    expect(countryJoinLabel('XK')).toBe('Kosovo');
  });

  it('keeps unknown tokens unchanged', () => {
    expect(countryJoinLabel('secret-north')).toBe('secret-north');
    expect(countryJoinLabel('')).toBe('');
  });

  it('matches every Natural Earth iso_a2 / iso_a3 onto catalog `name`', () => {
    const catalog = JSON.parse(readFileSync(COUNTRY_CATALOG, 'utf8')) as {
      features: Array<{
        properties: { name?: string; iso_a2?: string; iso_a3?: string };
      }>;
    };
    for (const feature of catalog.features) {
      const { name, iso_a2: iso2, iso_a3: iso3 } = feature.properties;
      if (!name) continue;
      if (typeof iso2 === 'string' && iso2 && iso2 !== '-99') {
        expect(countryJoinLabel(iso2)).toBe(name);
      }
      if (typeof iso3 === 'string' && iso3 && iso3 !== '-99') {
        expect(countryJoinLabel(iso3)).toBe(name);
      }
    }
  });
});
