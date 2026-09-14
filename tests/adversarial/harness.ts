/**
 * Shared harness for the fail-closed adversarial suite.
 *
 * Every case loads one hostile fixture, runs it through `validateSpec` against
 * the real engine catalog, and expects a refusal with an exact code. Nothing
 * here renders: `validateSpec` is pure, so the tripwires below prove a hostile
 * spec never reaches the element registry or the DOM on its way to a refusal.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect } from 'vitest';

import { loadWorkspaceCatalog } from '../../src/catalog/load-workspace.js';
import type { EngineCatalog } from '../../src/spec/engine-catalog.js';
import { validateSpec, type ValidationCode } from '../../src/validate/validate-spec.js';

/** The shipping engine-tier catalog — not a stub. Hostile specs face the real id list. */
export const catalog: EngineCatalog = loadWorkspaceCatalog();

export function hostileSpec(name: string): unknown {
  const path = fileURLToPath(new URL(`../fixtures/hostile/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/**
 * Load the named fixture, refuse it with exactly `code`, and prove no render
 * path was touched. A non-empty tripwire list means a hostile spec found a way
 * out of the validator.
 */
export function expectRefusal(name: string, code: ValidationCode): void {
  expectSpecRefusal(hostileSpec(name), code);
}

/**
 * Same guarantee for a spec built in the test rather than read from JSON — the
 * only reason to do so is a value JSON cannot carry, such as a live function.
 */
export function expectSpecRefusal(spec: unknown, code: ValidationCode): void {
  const disarm = armRenderTripwires();
  try {
    const result = validateSpec(spec, catalog);
    expect(result).toEqual({ ok: false, code, reason: expect.any(String) });
  } finally {
    const tripped = disarm();
    expect(tripped).toEqual([]);
  }
}

/**
 * Install recording stubs on the globals a renderer would reach for. Node has
 * none of these, so anything that fires them is code trying to paint. Returns a
 * disarm function that restores the globals and hands back what fired.
 */
function armRenderTripwires(): () => string[] {
  const tripped: string[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved: { key: string; had: boolean; value: unknown }[] = [];

  const trap =
    (label: string) =>
    (...args: unknown[]): undefined => {
      tripped.push(`${label}(${args.map((arg) => String(arg)).join(', ')})`);
      return undefined;
    };

  const install = (key: string, value: unknown): void => {
    saved.push({ key, had: key in globals, value: globals[key] });
    globals[key] = value;
  };

  install('customElements', {
    define: trap('customElements.define'),
    get: trap('customElements.get'),
    upgrade: trap('customElements.upgrade'),
    whenDefined: trap('customElements.whenDefined'),
  });
  install('document', {
    createElement: trap('document.createElement'),
    createElementNS: trap('document.createElementNS'),
    write: trap('document.write'),
  });

  return () => {
    for (const entry of saved.reverse()) {
      if (entry.had) globals[entry.key] = entry.value;
      else delete globals[entry.key];
    }
    return tripped;
  };
}
