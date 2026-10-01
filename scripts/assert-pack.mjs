/**
 * The published tarball must contain the compiled entry and the bin,
 * and must not ship TypeScript sources or an env file.
 * `--ignore-scripts` so prepack does not run the suite a second time.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = spawnSync(
  'npm',
  ['pack', '--ignore-scripts', '--dry-run', '--json'],
  { cwd: root, encoding: 'utf8' },
);

if (run.status !== 0) {
  console.error(run.stderr || run.stdout);
  process.exit(run.status ?? 1);
}

const start = run.stdout.indexOf('[');
const parsed = JSON.parse(run.stdout.slice(start));
const pack = Array.isArray(parsed) ? parsed[0] : parsed;
const files = (pack?.files ?? []).map((file) => file.path.replaceAll('\\', '/'));

function has(path) {
  return files.some((file) => file === path || file.endsWith(`/${path}`));
}

const missing = ['dist/index.js', 'bin/ui9000-workspace-server.mjs'].filter((path) => !has(path));
const leaked = files.filter(
  (file) => file.startsWith('src/') || file === '.env' || file.endsWith('/.env'),
);

if (missing.length > 0 || leaked.length > 0) {
  console.error(
    JSON.stringify({ missing, leaked: leaked.slice(0, 20), count: files.length }, null, 2),
  );
  process.exit(1);
}

console.log(`pack: ${files.length} files, dist entry present, sources omitted`);
