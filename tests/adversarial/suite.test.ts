/**
 * Guards the shape of the adversarial suite itself.
 *
 * The suite is only worth its name while it stays complete (one case per
 * validation code), fully enabled (no quiet `it.skip`), and refusal-only — a
 * case that reaches the interpreter or the element registry is no longer
 * proving that hostile specs are refused before anything renders.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { VALIDATION_CODES } from '../../src/validate/codes.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Every case file, by convention `NN-slug.test.ts`. */
const CASE_FILES = readdirSync(HERE)
  .filter((name) => /^\d{2}-.+\.test\.ts$/.test(name))
  .sort();

/** Substrings no case may contain: rendering, mounting, or registering elements. */
const RENDER_PATHS = [
  'customElements',
  'interpretWorkspace',
  'interpreter',
  'render(',
  '.mount(',
  'innerHTML',
  'document.',
];

describe('adversarial suite', () => {
  it('has one case per validation code', () => {
    expect(CASE_FILES).toEqual([
      '01-unknown-component.test.ts',
      '02-javascript-url.test.ts',
      '03-data-url.test.ts',
      '04-handler-prop.test.ts',
      '05-missing-bound-field.test.ts',
      '06-unmet-data.test.ts',
      '07-unlabelled-control.test.ts',
      '08-unknown-action.test.ts',
      '09-unnamed-tool.test.ts',
    ]);
    expect(CASE_FILES).toHaveLength(VALIDATION_CODES.length);
  });

  it('asserts each validation code exactly once across the suite', () => {
    const asserted = CASE_FILES.flatMap((name) =>
      VALIDATION_CODES.filter((code) => source(name).includes(`'${code}'`)),
    );
    expect([...asserted].sort()).toEqual([...VALIDATION_CODES].sort());
  });

  it('ships a hostile fixture for every case', () => {
    const fixtures = readdirSync(fileURLToPath(new URL('../fixtures/hostile', import.meta.url)));
    expect(fixtures.sort()).toEqual(
      CASE_FILES.map((name) => name.replace('.test.ts', '.json')),
    );
  });

  it('never reaches render, the interpreter, or customElements.define', () => {
    for (const name of CASE_FILES) {
      const body = source(name);
      for (const path of RENDER_PATHS) {
        expect(`${name}: ${body.includes(path)}`).toBe(`${name}: false`);
      }
    }
  });

  it('has no skipped or focused cases', () => {
    for (const name of CASE_FILES) {
      const body = source(name);
      expect(`${name}: ${/\b(?:it|test|describe)\.(?:skip|only|todo)\b/.test(body)}`).toBe(
        `${name}: false`,
      );
    }
  });
});

function source(name: string): string {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}
