#!/usr/bin/env node
/**
 * CI gate: no raw dataset rows in any trace payload committed to this repo.
 *
 * A trace is a decision record — objective, profile facts, candidates, scores,
 * rejections. It is published to Storybook and pasted into tickets, so rows
 * reaching one is a data leak, not a formatting mistake. The vitest suites
 * (`packages/core/tests/eval/no-rows.test.ts`, the Inspector stories gate) hold
 * the line on traces the engine *produces*; this script holds it on traces
 * committed as text, which no test would otherwise parse.
 *
 * Scope is by shape, not by path, because paths move:
 *
 *   - anything named `*.trace.json`, wherever it lives
 *   - any JSON document that *looks* like a trace (an `objective` string beside
 *     a `candidates` or `rejections` array), at any depth
 *   - the eval fixture trees, whose recordings are profile facts and must stay
 *     counts rather than rows
 *
 * Deliberately out of scope: `tests/parity/fixtures/mcp-ui-responses.json`. Those
 * are recorded pre-cutover `generate_*` responses and carry real `data` arrays on
 * purpose — the parity suite exists to compare them against the trace-based flow.
 * Banning rows there would ban the fixture the comparison needs. It is excluded by
 * shape (no `objective`), not by name, so a trace dropped into that tree is still
 * caught.
 *
 * Usage: node scripts/no-raw-rows.mjs    (exit 1 and a file:line report on a hit)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, join } from 'node:path';

const REPO = fileURLToPath(new URL('..', import.meta.url));

/** Trees that hold fixtures, traces and stories. Build output is not reviewed. */
const ROOTS = ['tests', 'scripts'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'storybook-static', '.git']);

/** Eval fixtures: profile recordings, which must carry counts and never rows. */
const FIXTURE_TREES = ['tests/fixtures/', 'tests/eval/'];

/** The leak, as it appears in pretty-printed JSON. */
const ROWS = /"(rows|data)"\s*:\s*\[/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (entry.endsWith('.json')) out.push(path);
  }
  return out;
}

/** An `objective` string beside candidates or rejections — a trace, at any depth. */
function looksLikeTrace(value) {
  if (Array.isArray(value)) return value.some(looksLikeTrace);
  if (!value || typeof value !== 'object') return false;
  if (
    typeof value.objective === 'string' &&
    (Array.isArray(value.candidates) || Array.isArray(value.rejections))
  ) {
    return true;
  }
  return Object.values(value).some(looksLikeTrace);
}

function inScope(rel, text) {
  if (rel.endsWith('.trace.json')) return 'named a trace';
  if (FIXTURE_TREES.some((tree) => rel.startsWith(tree))) return 'an eval fixture';
  try {
    if (looksLikeTrace(JSON.parse(text))) return 'shaped like a trace';
  } catch {
    return null; // A JSON file that will not parse is another suite's problem.
  }
  return null;
}

const offenders = [];
let checked = 0;

for (const root of ROOTS) {
  for (const path of walk(join(REPO, root))) {
    const rel = relative(REPO, path);
    const text = readFileSync(path, 'utf8');
    const why = inScope(rel, text);
    if (!why) continue;
    checked += 1;
    text.split('\n').forEach((line, index) => {
      if (ROWS.test(line)) offenders.push({ rel, line: index + 1, text: line.trim(), why });
    });
  }
}

if (checked === 0) {
  console.error('no-raw-rows: checked 0 trace payloads — the gate is not looking anywhere.');
  process.exit(1);
}

if (offenders.length > 0) {
  console.error(`no-raw-rows: dataset rows in ${offenders.length} place(s):\n`);
  for (const hit of offenders) {
    console.error(`  ${hit.rel}:${hit.line}  (${hit.why})`);
    console.error(`    ${hit.text}`);
  }
  console.error('\nA trace records a decision, not the data it decided on.');
  console.error('Record a count (`rowCount`) instead of the rows themselves.');
  process.exit(1);
}

console.log(`no-raw-rows: ${checked} trace payload(s) checked, no dataset rows.`);
