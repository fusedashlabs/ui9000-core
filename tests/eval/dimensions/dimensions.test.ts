/**
 * S4-01 / FUS-4107 — the five-dimension eval suite.
 *
 * Two things are under test here, and they are different things.
 *
 * 1. The cases. Every fixture in `cases/` is run down the shipping path and
 *    checked by its dimension's checker. There is one `it` per fixture and no
 *    `it` per assertion: a new case is a JSON file, so this file does not grow
 *    when the eval set does, and neither does the engine.
 *
 * 2. The enum. `dimension` is closed. A fixture naming a sixth dimension — or
 *    a near miss like "A11y", "accessibility", "selection " — fails at parse
 *    time with the closed set in the message, whether it is handed to the
 *    parser directly or dropped into a cases directory on disk.
 *
 * Untouched on purpose: tests/eval/four-intents.test.ts, src/engine,
 * tests/adversarial.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DATA_PROFILE_KEYS } from '../../../src/spec/data-profile.js';
import { INTENTS } from '../../../src/spec/intent.js';
import { VALIDATION_CODES } from '../../../src/validate/validate-spec.js';
import {
  EVAL_DIMENSIONS,
  EvalFixtureError,
  parseEvalCase,
  POLICY_PROBES,
} from './dimensions.js';
import { checkEvalRun, loadEvalCases, runEvalCase } from './harness.js';

const cases = loadEvalCases();

/** A minimal valid fixture the negative tests bend one field at a time. */
function fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'inline-case',
    dimension: 'selection',
    intent: 'comparison',
    profile: 'category-metric',
    expect: { winner: 'bar-chart' },
    ...overrides,
  };
}

function parseFails(raw: Record<string, unknown>, match: RegExp): void {
  expect(() => parseEvalCase(raw, 'inline')).toThrow(EvalFixtureError);
  expect(() => parseEvalCase(raw, 'inline')).toThrow(match);
}

/** Write one fixture into a throwaway cases directory and load it from disk. */
function loadFromDisk(body: unknown, name = 'inline-case.json'): void {
  const dir = mkdtempSync(join(tmpdir(), 'eval-dimensions-')) + sep;
  writeFileSync(`${dir}${name}`, `${JSON.stringify(body, null, 2)}\n`);
  loadEvalCases(dir);
}

describe('eval cases', () => {
  it('has fixtures to run', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it('covers all five dimensions', () => {
    const covered = new Set(cases.map((item) => item.dimension));
    expect([...covered].sort()).toEqual([...EVAL_DIMENSIONS].sort());
  });

  it('exercises every policy probe', () => {
    const probed = new Set(
      cases
        .filter((item) => item.dimension === 'policy')
        .map((item) => (item.expect as { probe: string }).probe),
    );
    expect([...probed].sort()).toEqual([...POLICY_PROBES].sort());
  });

  it('declares only closed dimensions and closed intents', () => {
    for (const item of cases) {
      expect(EVAL_DIMENSIONS, item.id).toContain(item.dimension);
      expect(INTENTS, item.id).toContain(item.intent);
    }
  });

  it.each(cases.map((item) => [item.id, item] as const))('%s', async (_id, item) => {
    const run = await runEvalCase(item);
    expect(checkEvalRun(run)).toEqual([]);
  });
});

describe('closed dimension enum', () => {
  it('is exactly the five S4-01 dimensions', () => {
    expect([...EVAL_DIMENSIONS]).toEqual(['selection', 'schema', 'data_accuracy', 'a11y', 'policy']);
  });

  it('refuses a sixth dimension, naming the closed set', () => {
    parseFails(fixture({ dimension: 'latency' }), /dimension "latency" is outside the closed eval enum/);
    parseFails(fixture({ dimension: 'latency' }), /selection \| schema \| data_accuracy \| a11y \| policy/);
  });

  it('refuses near misses — casing, spacing, synonyms', () => {
    for (const dimension of ['A11y', 'accessibility', 'selection ', 'data-accuracy', 'Policy']) {
      parseFails(fixture({ dimension }), /outside the closed eval enum/);
    }
  });

  it('refuses a missing or non-string dimension', () => {
    parseFails(fixture({ dimension: undefined }), /dimension must be a string/);
    parseFails(fixture({ dimension: '' }), /dimension must be a string/);
    parseFails(fixture({ dimension: ['a11y'] }), /dimension must be a string/);
  });

  it('refuses a bad dimension in a cases directory, not just in memory', () => {
    expect(() => loadFromDisk(fixture({ dimension: 'latency' }))).toThrow(EvalFixtureError);
    expect(() => loadFromDisk(fixture({ dimension: 'latency' }))).toThrow(
      /inline-case\.json: dimension "latency" is outside the closed eval enum/,
    );
    expect(() => loadFromDisk(fixture())).not.toThrow();
  });
});

describe('fixture parsing', () => {
  it('accepts the minimal fixture', () => {
    const parsed = parseEvalCase(fixture(), 'inline');
    expect(parsed).toEqual({
      id: 'inline-case',
      dimension: 'selection',
      intent: 'comparison',
      profile: { name: 'category-metric', overrides: {} },
      expect: { winner: 'bar-chart' },
    });
  });

  it('refuses an intent outside the closed intent enum', () => {
    parseFails(fixture({ intent: 'timeline' }), /intent must be one of/);
  });

  it('refuses unknown fixture and expect keys', () => {
    parseFails(fixture({ weight: 2 }), /unknown fixture key: "weight"/);
    parseFails(fixture({ expect: { winner: 'bar-chart', latencyMs: 5 } }), /unknown expect key/);
  });

  it('refuses an expect that asserts nothing', () => {
    parseFails(fixture({ expect: {} }), /expect is empty/);
    parseFails(fixture({ expect: { alsoEligible: ['table'] } }), /selection expect requires "winner"/);
  });

  it('refuses profile keys outside the closed DataProfile', () => {
    parseFails(
      fixture({ profile: { name: 'category-metric', hasVibes: true } }),
      /profile key "hasVibes" is outside the closed DataProfile/,
    );
    expect(DATA_PROFILE_KEYS).toContain('hasMapToken');
    expect(() =>
      parseEvalCase(fixture({ profile: { name: 'geo-lat-lng', hasMapToken: true } }), 'inline'),
    ).not.toThrow();
  });

  it('requires a named dataset for every dimension that reads the spec', () => {
    const asserts: Record<string, Record<string, unknown>> = {
      schema: { component: 'bar-chart' },
      data_accuracy: { rowCount: 4 },
      a11y: { label: 'bar-chart' },
      policy: { probe: 'none', refusalCode: null },
    };
    for (const [dimension, expected] of Object.entries(asserts)) {
      parseFails(
        fixture({ dimension, profile: { hasCategory: true }, expect: expected }),
        /profile\.name must be a fixture under tests\/fixtures\/profiles/,
      );
    }
    // `selection` needs no dataset: a profile alone decides the winner.
    expect(() =>
      parseEvalCase(
        fixture({ profile: { hasCategory: true, hasNumericMetric: true }, expect: { winner: 'bar-chart' } }),
        'inline',
      ),
    ).not.toThrow();
  });

  it('refuses an unknown policy probe or refusal code', () => {
    parseFails(
      fixture({ dimension: 'policy', expect: { probe: 'sql-injection', refusalCode: 'javascript_url' } }),
      /expect\.probe must be one of/,
    );
    parseFails(
      fixture({ dimension: 'policy', expect: { probe: 'none', refusalCode: 'too_spicy' } }),
      /expect\.refusalCode must be null or one of/,
    );
    parseFails(
      fixture({ dimension: 'policy', expect: { probe: 'none' } }),
      /policy expect requires "refusalCode"/,
    );
    expect(POLICY_PROBES).toContain('script-url');
    expect(VALIDATION_CODES).toContain('javascript_url');
  });

  it('refuses a case id that does not match its file name, and duplicate ids', () => {
    expect(() => loadFromDisk(fixture(), 'other-name.json')).toThrow(/must match the file name/);
  });
});
