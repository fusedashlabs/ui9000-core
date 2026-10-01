import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { DataProfile } from '../spec/data-profile.js';
import { evalWhen } from './when.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Parser body must match widgets — only the DataProfile import path may differ. */
function stripImport(source: string): string {
  return source.replace(/^import[^\n]*\n/, '');
}

describe('when parser', () => {
  it('stays in lockstep with widgets catalog/when.ts', () => {
    const core = readFileSync(join(here, 'when.ts'), 'utf8');
    const widgets = readFileSync(join(here, '../../vendor/ui9000-widgets/src/catalog/when.ts'), 'utf8');
    expect(stripImport(core)).toBe(stripImport(widgets));
  });

  it('evaluates closed profile comparisons and refuses a call', () => {
    const profile: DataProfile = {
      hasCategory: true,
      categoryCardinality: 4,
      rowCount: 10,
    };
    expect(evalWhen('profile.hasCategory && profile.categoryCardinality <= 12', profile)).toBe(
      true,
    );
    expect(evalWhen('profile.categoryCardinality > 12 || !profile.hasCategory', profile)).toBe(
      false,
    );
    expect(() => evalWhen('profile.rowCount()', profile)).toThrow(/calls/);
    expect(() => evalWhen('profile.notAKey === 1', profile)).toThrow(/unknown/);
  });
});
