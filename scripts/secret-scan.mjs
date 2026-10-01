/**
 * Fail the build when a high-confidence secret shape is committed.
 * Skips dependencies, build output, and the vendored widgets checkout.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'vendor', '.git', '.yarn', 'coverage']);
const PATTERNS = [
  { name: 'private key', re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'aws access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'github token', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'npm token', re: /npm_[A-Za-z0-9]{36}/ },
];

const hits = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const next = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(next);
      continue;
    }
    if (!entry.isFile()) continue;
    let text;
    try {
      const stat = statSync(next);
      if (stat.size > 1_000_000) continue;
      text = readFileSync(next, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    for (const pattern of PATTERNS) {
      if (pattern.re.test(text)) {
        hits.push(`${relative(ROOT, next)}: ${pattern.name}`);
      }
    }
  }
}

walk(ROOT);
if (hits.length > 0) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log('secret-scan: clean');
