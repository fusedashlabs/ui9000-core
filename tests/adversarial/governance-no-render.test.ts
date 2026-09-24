/**
 * Regression for the governance surface, guarding the seam the nine cases do
 * not: they prove `validateSpec` refuses a hostile spec, which says nothing
 * about the inspector panel that reads a decision *trace*. A hostile widget
 * spec is not a trace, so handing one to the panel must be refused — with a
 * reason — rather than normalized into something it will paint.
 *
 * The import below is deliberately static. An existence check that skipped
 * when the panel moved would let this gate go quietly green the day someone
 * renames the module, which is the one failure an adversarial suite must not
 * have; a hard import turns that into a loud collection error instead.
 *
 * This file sits outside the `NN-slug` naming `suite.test.ts` counts, so the
 * numbered gate still sees exactly nine cases and stays 9/9.
 */

import { describe, expect, it } from 'vitest';

import { normalizeTrace } from '../../vendor/ui9000-widgets/src/components/inspector/lib/index.js';
import { VALIDATION_CODES } from '../../src/validate/codes.js';
import { expectNoRenderPath, hostileSpec } from './harness.js';

/** Every hostile fixture, named from the numbered cases so the two stay in step. */
const HOSTILE_CASES = [
  '01-unknown-component',
  '02-javascript-url',
  '03-data-url',
  '04-handler-prop',
  '05-missing-bound-field',
  '06-unmet-data',
  '07-unlabelled-control',
  '08-unknown-action',
  '09-unnamed-tool',
];

describe('adversarial: inspector refuses hostile specs', () => {
  it('covers every hostile fixture the numbered gate ships', () => {
    expect(HOSTILE_CASES).toHaveLength(VALIDATION_CODES.length);
  });

  it.each(HOSTILE_CASES)('refuses %s instead of rendering it', (name) => {
    const result = expectNoRenderPath(() => normalizeTrace(hostileSpec(name)));
    expect(result).toEqual({ ok: false, blocked: expect.any(String) });
  });

  it('refuses a hostile spec dressed as a trace to smuggle dataset rows', () => {
    const disguised = {
      objective: 'Show findings by severity',
      winner: 'bar-chart',
      rows: [{ severity: 'high', finding_count: 12 }],
    };
    const result = expectNoRenderPath(() => normalizeTrace(disguised));
    expect(result).toEqual({ ok: false, blocked: expect.any(String) });
  });
});
