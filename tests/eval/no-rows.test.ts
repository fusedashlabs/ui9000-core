/**
 * Eval gate: a trace is a decision record, and never the dataset it decided on.
 *
 * `assertTraceHasNoRows` already guards the four intents in `four-intents.test.ts`
 * and the cutover demo in `tests/scripts/`. Both run one dataset. That leaves the
 * interesting direction untested: the guard is a recursive walk, so the way it
 * breaks is not "it stops working" but "it stops reaching" — a profile shape no
 * eval covered, an intent whose winner nests differently, a trace file committed
 * by hand. So this suite widens the gate along all three axes at once:
 *
 *   dimension  — every fixture in `tests/fixtures/profiles/`, one per documented
 *                profile shape (geo, category+metric, entity id, events, claims,
 *                graph links, tabular rows, and both control tables)
 *   intent     — every value of the closed `INTENTS` enum, not just the four the
 *                eval dataset wins with
 *   host       — with and without a map token, because the token moves the
 *                spatial winner and therefore the branch that fills `actions`
 *
 * Every trace produced that way must pass the guard, and — separately — every
 * trace payload already committed to this package must pass it too.
 *
 * The five-dimension eval set is gated in its own harness rather than here:
 * `checkEvalRun` in `dimensions/harness.ts` runs the guard on every case ahead
 * of the dimension checker, so all 76 are covered and not only the twelve that
 * spell out `noRowsInTrace`. This file is the other half — the profile shapes
 * and intents no case happens to name, and the traces committed as text.
 *
 * The suite is deliberately fail-closed in both directions. Passing because the
 * guard is a no-op is the failure mode that would matter most here, so each
 * fixture is also run doctored: rows smuggled in at three depths, each of which
 * must throw. A guard that silently stopped walking fails this file rather than
 * passing it quietly.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadWorkspaceCatalog } from '../../src/catalog/load-workspace.js';
import { decide } from '../../src/engine/decide.js';
import { profileColumns, type ProfileEnv } from '../../src/profiler/profile-columns.js';
import { parseCsvTable } from '../../src/profiler/table.js';
import type { DataProfile } from '../../src/spec/data-profile.js';
import { INTENTS } from '../../src/spec/intent.js';
import { assertTraceHasNoRows, type Trace } from '../../src/trace/trace.js';

const EVAL_DIR = fileURLToPath(new URL('.', import.meta.url));
const PROFILE_DIR = fileURLToPath(new URL('../fixtures/profiles/', import.meta.url));
const DATASET_DIR = fileURLToPath(new URL('../fixtures/datasets/', import.meta.url));

/** Committed trace payloads: recorded decisions, checked in and reviewed as text. */
const TRACE_DIRS = [
  fileURLToPath(new URL('./__snapshots__/', import.meta.url)),
  fileURLToPath(new URL('../../scripts/s3-21-demo/', import.meta.url)),
  fileURLToPath(new URL('../fixtures/inspector/', import.meta.url)),
];

/** The token is a host capability, so it is the one axis no column can move. */
const HOSTS: readonly (readonly [string, ProfileEnv])[] = [
  ['no map token', {}],
  ['map token', { hasMapToken: true }],
];

const catalog = loadWorkspaceCatalog();

/** One fixture per documented profile shape — the dimensions this gate sweeps. */
const dimensions: string[] = readdirSync(PROFILE_DIR)
  .filter((file) => file.endsWith('.csv'))
  .map((file) => file.replace(/\.csv$/, ''))
  .sort();

function dimensionProfile(name: string, host: ProfileEnv): DataProfile {
  return profileColumns(parseCsvTable(readFileSync(`${PROFILE_DIR}${name}.csv`, 'utf8')), host);
}

/** Every trace one fixture produces: one per intent, under one host. */
function tracesFor(profile: DataProfile): Trace[] {
  return INTENTS.map((intent) => decide({ intent, profile, catalog }).trace);
}

/**
 * The three depths the walker has to reach: the trace itself, an object nested
 * one level down, and an object inside an array. A guard that checks only the
 * top level passes the first and fails the rest.
 */
function smuggled(trace: Trace): readonly (readonly [string, unknown])[] {
  return [
    ['at the top level', { ...trace, rows: [{ region: 'North', incidents: 12 }] }],
    ['nested under a key', { ...trace, outcome: { data: [{ region: 'North' }] } }],
    [
      'inside a candidate array',
      { ...trace, candidates: [...trace.candidates, { id: 'table', rows: [{ a: 1 }] }] },
    ],
  ];
}

describe('dimension fixtures', () => {
  it('sweeps every documented shape — an empty sweep is a failure, not a pass', () => {
    expect(dimensions).toEqual([
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

  it('carries no rows array in the recorded profile itself', () => {
    for (const name of dimensions) {
      const raw = readFileSync(`${PROFILE_DIR}${name}.json`, 'utf8');
      expect(raw, name).not.toMatch(/"(rows|data)"\s*:\s*\[/);
    }
  });

  describe.each(HOSTS)('under %s', (_label, host) => {
    it.each(dimensions)('%s decides every intent without leaking rows', (name) => {
      const profile = dimensionProfile(name, host);
      const traces = tracesFor(profile);

      expect(traces).toHaveLength(INTENTS.length);
      for (const [index, trace] of traces.entries()) {
        const intent = INTENTS[index];
        expect(() => assertTraceHasNoRows(trace), `${name}/${intent}`).not.toThrow();
        // The profile is the only data the trace may carry, and only as facts.
        expect(Object.values(trace.profile).some(Array.isArray), `${name}/${intent}`).toBe(false);
        // A trace that cannot round-trip is a trace holding something non-JSON.
        expect(JSON.parse(JSON.stringify(trace)), `${name}/${intent}`).toEqual(trace);
      }
    });

    it.each(dimensions)('%s refuses rows smuggled into its trace', (name) => {
      const profile = dimensionProfile(name, host);

      for (const trace of tracesFor(profile)) {
        for (const [where, doctored] of smuggled(trace)) {
          expect(
            () => assertTraceHasNoRows(doctored as Trace),
            `${name}: rows ${where}`,
          ).toThrow('trace must not contain rows');
        }
      }
    });
  });
});

describe('eval dataset fixture', () => {
  const recorded: DataProfile = JSON.parse(
    readFileSync(`${DATASET_DIR}regional-incidents.json`, 'utf8'),
  );

  it('decides every intent on the recorded profile without leaking rows', () => {
    for (const intent of INTENTS) {
      const { trace } = decide({ intent, profile: recorded, catalog });
      expect(() => assertTraceHasNoRows(trace), intent).not.toThrow();
    }
  });

  it('records ten rows as a count, and never as rows', () => {
    const { trace } = decide({ intent: 'summary', profile: recorded, catalog });
    expect(trace.profile.rowCount).toBe(10);
    expect(JSON.stringify(trace)).not.toMatch(/"(rows|data)"\s*:\s*\[/);
  });
});

describe('committed trace payloads', () => {
  /** `[label, path]` — the label leads so test names stay machine-independent. */
  const files = TRACE_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((file) => file.endsWith('.trace.json') || file === 'trace.v2.json')
      .map((file) => [`${relative(EVAL_DIR, dir)}/${file}`, `${dir}${file}`] as const),
  );

  it('finds the recorded traces it is meant to police', () => {
    expect(files.length).toBeGreaterThanOrEqual(INTENTS.length);
  });

  it.each(files)('%s carries a decision and not a dataset', (_label, path) => {
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toMatch(/"(rows|data)"\s*:\s*\[/);
    expect(() => assertTraceHasNoRows(JSON.parse(raw) as Trace)).not.toThrow();
  });
});
