import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadWorkspaceCatalog } from '../catalog/load-workspace.js';
import { decide } from '../engine/decide.js';
import { DATA_PROFILE_KEYS } from '../spec/data-profile.js';
import { assertClosedProfile, profileColumns } from './profile-columns.js';
import { parseCsvTable, type Table } from './table.js';

const FIXTURE_DIR = fileURLToPath(new URL('../../tests/fixtures/profiles/', import.meta.url));

const fixtureNames: string[] = (readdirSync(FIXTURE_DIR) as string[])
  .filter((file) => file.endsWith('.csv'))
  .map((file) => file.replace(/\.csv$/, ''))
  .sort();

function readCsv(name: string): string {
  return readFileSync(`${FIXTURE_DIR}${name}.csv`, 'utf8');
}

function readExpected(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}.json`, 'utf8'));
}

function table(header: string, ...rows: string[]): Table {
  return parseCsvTable([header, ...rows].join('\n'));
}

describe('profileColumns fixtures', () => {
  it('covers every documented shape', () => {
    expect(fixtureNames).toEqual([
      'category-metric',
      'claim-sources',
      'cyber-alert-events',
      'cyber-asset-graph',
      'cyber-threat-claims',
      'entity-id',
      'events-with-ts',
      'form-all-labelled',
      'form-unlabelled-control',
      'geo-lat-lng',
      'nodes-links',
      'regional-incidents',
      'tabular-rows',
    ]);
  });

  it.each(fixtureNames)('%s matches its recorded profile', (name) => {
    expect(profileColumns(parseCsvTable(readCsv(name)))).toEqual(readExpected(name));
  });

  it.each(fixtureNames)('%s records only closed keys', (name) => {
    expect(() => assertClosedProfile(readExpected(name), name)).not.toThrow();
    expect(Object.keys(readExpected(name))).toEqual([...DATA_PROFILE_KEYS]);
  });
});

describe('profileColumns determinism', () => {
  it.each(fixtureNames)('%s is bit-for-bit stable across runs', (name) => {
    const csv = readCsv(name);
    const first = JSON.stringify(profileColumns(parseCsvTable(csv)));
    const second = JSON.stringify(profileColumns(parseCsvTable(csv)));
    expect(second).toBe(first);
    expect(`${JSON.stringify(profileColumns(parseCsvTable(csv)), null, 2)}\n`).toBe(
      readFileSync(`${FIXTURE_DIR}${name}.json`, 'utf8'),
    );
  });

  it('emits every key in the frozen order', () => {
    const profile = profileColumns(parseCsvTable(readCsv('category-metric')));
    expect(Object.keys(profile)).toEqual([...DATA_PROFILE_KEYS]);
  });

  it('is unaffected by column order for whole-table facts', () => {
    const forward = profileColumns(table('department,revenue', 'Sales,10', 'Design,4'));
    const reversed = profileColumns(table('revenue,department', '10,Sales', '4,Design'));
    expect(reversed).toEqual(forward);
  });
});

describe('closed profile guard', () => {
  it('fails on a key outside DATA_PROFILE_KEYS', () => {
    const profile = {
      ...profileColumns(parseCsvTable(readCsv('category-metric'))),
      hasOutlier: true,
    };
    expect(() => assertClosedProfile(profile)).toThrow(/unknown DataProfile key "hasOutlier"/);
  });

  it('does not silently drop the unknown key', () => {
    const profile = { ...readExpected('geo-lat-lng'), geoPrecision: 'city' };
    expect(() => assertClosedProfile(profile, 'geo-lat-lng')).toThrow(
      /geo-lat-lng has unknown DataProfile key "geoPrecision"/,
    );
    expect(Object.keys(profile)).toContain('geoPrecision');
  });
});

describe('column roles', () => {
  it('reads lat/lng as geo, not as a numeric metric', () => {
    const profile = profileColumns(table('lat,lng', '51.5,-0.12', '53.4,-2.24'));
    expect(profile.hasGeo).toBe(true);
    expect(profile.hasNumericMetric).toBe(false);
  });

  it('reads a region id as geo without a lat/lng pair', () => {
    expect(profileColumns(table('country,value', 'FR,3', 'DE,9')).hasGeo).toBe(true);
  });

  it('keeps a lone lat column out of geo', () => {
    expect(profileColumns(table('lat,value', '51.5,3')).hasGeo).toBe(false);
  });

  it('reads year as temporal, not as a metric', () => {
    const profile = profileColumns(table('year,label', '2024,a', '2025,b'));
    expect(profile.hasTemporal).toBe(true);
    expect(profile.hasNumericMetric).toBe(false);
  });

  it('reads ISO values as temporal without a header hint', () => {
    expect(profileColumns(table('booked,seats', '2026-03-01,4')).hasTemporal).toBe(true);
  });

  it('needs both endpoints before a column is a link', () => {
    const graph = profileColumns(table('source,target', 'a,b'));
    expect([graph.hasNodes, graph.hasLinks]).toEqual([true, true]);

    const citation = profileColumns(table('claim,source', 'x,report'));
    expect([citation.hasNodes, citation.hasLinks]).toEqual([false, false]);
    expect(citation.hasClaim).toBe(true);
  });

  it('needs a clock before events are a timeline', () => {
    expect(profileColumns(table('event,actor', 'signup,ana')).hasEvents).toBe(false);
    expect(profileColumns(table('event,ts', 'signup,2026-01-04')).hasEvents).toBe(true);
  });

  it('counts an entity id only when its values are unique', () => {
    expect(profileColumns(table('entity_id,name', 'E-1,Ana', 'E-2,Bo')).hasEntityId).toBe(true);
    expect(profileColumns(table('entity_id,name', 'E-1,Ana', 'E-1,Bo')).hasEntityId).toBe(false);
  });

  it('counts the first category column for cardinality', () => {
    const profile = profileColumns(
      table('team,status,value', 'a,open,1', 'b,open,2', 'c,shut,3', 'a,shut,4'),
    );
    expect(profile.hasCategory).toBe(true);
    expect(profile.categoryCardinality).toBe(3);
  });

  it('ignores blank cells', () => {
    const profile = profileColumns(table('team,value', 'a,1', ',2', 'b,'));
    expect(profile.categoryCardinality).toBe(2);
    expect(profile.rowCount).toBe(3);
  });
});

describe('controls', () => {
  it('fails allControlsLabelled when one control has no label', () => {
    const profile = profileColumns(parseCsvTable(readCsv('form-unlabelled-control')));
    expect(profile.controlCount).toBe(2);
    expect(profile.allControlsLabelled).toBe(false);
  });

  it('passes allControlsLabelled when every control is named', () => {
    const profile = profileColumns(parseCsvTable(readCsv('form-all-labelled')));
    expect(profile.controlCount).toBe(2);
    expect(profile.allControlsLabelled).toBe(true);
  });

  it('does not report control rows as dataset rows', () => {
    expect(profileColumns(parseCsvTable(readCsv('form-all-labelled'))).hasTabularRows).toBe(false);
  });

  it('reports no controls, and not a vacuous pass, for a dataset table', () => {
    const profile = profileColumns(parseCsvTable(readCsv('category-metric')));
    expect(profile.controlCount).toBe(0);
    expect(profile.allControlsLabelled).toBe(false);
  });

  it('treats a control table with no label column as unlabelled', () => {
    const profile = profileColumns(table('control,type', 'email,text'));
    expect(profile.controlCount).toBe(1);
    expect(profile.allControlsLabelled).toBe(false);
  });

  it('keeps id,field,value as dataset rows, not a control table', () => {
    const profile = profileColumns(table('id,field,value', '1,temp,10', '2,pressure,20'));
    expect(profile.hasTabularRows).toBe(true);
    expect(profile.hasNumericMetric).toBe(true);
    expect(profile.controlCount).toBe(0);
    expect(profile.rowCount).toBe(2);
  });
});

describe('host capabilities', () => {
  it('never infers a map token from columns', () => {
    expect(profileColumns(parseCsvTable(readCsv('geo-lat-lng'))).hasMapToken).toBe(false);
  });

  it('takes the map token from the host', () => {
    const profile = profileColumns(parseCsvTable(readCsv('geo-lat-lng')), { hasMapToken: true });
    expect(profile.hasMapToken).toBe(true);
  });
});

describe('empty input', () => {
  it('profiles an empty table without inventing signals', () => {
    const profile = profileColumns(parseCsvTable(''));
    expect(Object.keys(profile)).toEqual([...DATA_PROFILE_KEYS]);
    expect(profile.rowCount).toBe(0);
    expect(profile.hasTabularRows).toBe(false);
    expect(profile.hasCategory).toBe(false);
  });

  it('profiles a header-only table as zero rows', () => {
    const profile = profileColumns(parseCsvTable('department,revenue\n'));
    expect(profile.rowCount).toBe(0);
    expect(profile.hasTabularRows).toBe(false);
  });
});

/** A profile only earns its keys if the real engine catalog can read it. */
describe('feeds the engine catalog', () => {
  const catalog = loadWorkspaceCatalog();

  function eligibleFor(intent: Parameters<typeof decide>[0]['intent'], name: string): string[] {
    const profile = profileColumns(parseCsvTable(readCsv(name)));
    return decide({ intent, profile, catalog }).eligible.map((entry) => entry.id);
  }

  it('picks map-chart for lat/lng once the host has a token', () => {
    const profile = profileColumns(parseCsvTable(readCsv('geo-lat-lng')), { hasMapToken: true });
    expect(decide({ intent: 'spatial', profile, catalog }).winner).toBe('map-chart');
  });

  it('leaves nothing spatial eligible while the host has no token', () => {
    const profile = profileColumns(parseCsvTable(readCsv('geo-lat-lng')));
    expect(decide({ intent: 'spatial', profile, catalog }).winner).toBeNull();
  });

  it('picks bar-chart for category plus metric', () => {
    expect(eligibleFor('comparison', 'category-metric')).toContain('bar-chart');
  });

  it('picks network-graph for source/target rows', () => {
    expect(eligibleFor('graph', 'nodes-links')).toEqual(['network-graph']);
  });

  it('makes event-timeline eligible for events with a ts column', () => {
    expect(eligibleFor('evidence', 'events-with-ts')).toContain('event-timeline');
  });

  it('makes entity-detail eligible for a unique entity id', () => {
    expect(eligibleFor('evidence', 'entity-id')).toContain('entity-detail');
  });

  it('makes evidence-panel eligible for a claim with sources', () => {
    expect(eligibleFor('evidence', 'claim-sources')).toContain('evidence-panel');
  });

  it('makes table eligible for plain tabular rows', () => {
    expect(eligibleFor('evidence', 'tabular-rows')).toContain('table');
  });

  it('leaves no form control eligible when one control is unlabelled', () => {
    expect(eligibleFor('form', 'form-unlabelled-control')).toEqual([]);
  });

  it('makes form controls eligible when every control is labelled', () => {
    expect(eligibleFor('form', 'form-all-labelled')).toContain('form');
  });

  it('keeps form controls out of a dataset table', () => {
    expect(eligibleFor('form', 'category-metric')).toEqual([]);
  });
});
