import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** Parser body must match widgets — only the DataProfile import path may differ. */
function stripImport(source: string): string {
  return source.replace(/^import[^\n]*\n/, '');
}

describe('when parser', () => {
  it('stays in lockstep with widgets catalog/when.ts', () => {
    const core = readFileSync(join(here, 'when.ts'), 'utf8');
    const widgets = readFileSync(join(here, '../../../widgets/src/catalog/when.ts'), 'utf8');
    expect(stripImport(core)).toBe(stripImport(widgets));
  });
});
