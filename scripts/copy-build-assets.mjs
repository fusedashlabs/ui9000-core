/**
 * tsc does not copy the JSON catalogs or the demo CSV next to the emitted JS.
 * The server reads both via import.meta.url, so they have to sit in dist/.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const copies = [
  ['src/migrate/map-validation/catalogs', 'dist/migrate/map-validation/catalogs'],
  ['src/demo/regional-incidents.csv', 'dist/demo/regional-incidents.csv'],
];

for (const [from, to] of copies) {
  const target = join(root, to);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, from), target, { recursive: true });
}
