/**
 * S4-14 / FUS-4119 — the scorecard generator.
 *
 * SCORECARD.md is a *report*, not a document: every number in it is read back
 * from a run of the suites that already exist, so the only way to move a number
 * is to move a test. Nothing here estimates, rounds, or carries a figure
 * forward from a previous run.
 *
 * How a number gets here:
 *
 *   what the set holds   the fixtures in tests/eval/dimensions/cases, parsed
 *                        with the suite's own `parseEvalCase` — so the per
 *                        dimension counts come from the closed enum, and a
 *                        malformed fixture stops the generator the same way it
 *                        stops the suite.
 *   pass / fail          one real `vitest run` over tests/eval/dimensions and
 *                        tests/adversarial, read back through the JSON
 *                        reporter. Re-deriving results in-process could report
 *                        a green scorecard over a red suite, so it is vitest's
 *                        verdict or nothing. A case the run never reported is
 *                        counted as not run, never as a pass.
 *
 * Floors (S4-14): the eval set must hold at least TOTAL_FLOOR cases and every
 * dimension at least DIMENSION_FLOOR, and the adversarial suite must be whole —
 * one passing case per validation code. A breach exits non-zero *after* writing
 * the file, so CI fails with the red scorecard on disk to look at.
 *
 * Untouched: src/engine, the eval harness, the adversarial suite. This script
 * reads them and writes one markdown file.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { VALIDATION_CODES } from '../src/validate/codes.js';
import {
  EVAL_DIMENSIONS,
  parseEvalCase,
  type EvalDimension,
} from '../tests/eval/dimensions/dimensions.js';

/** The eval set must hold at least this many cases in total. */
export const TOTAL_FLOOR = 50;

/** …and at least this many in every single dimension. */
export const DIMENSION_FLOOR = 8;

const CORE_DIR = fileURLToPath(new URL('../', import.meta.url));
const EVAL_DIR = join(CORE_DIR, 'tests/eval/dimensions');
const EVAL_CASES_DIR = join(EVAL_DIR, 'cases');
const ADVERSARIAL_DIR = join(CORE_DIR, 'tests/adversarial');
const EVAL_TEST_FILE = 'dimensions.test.ts';
const ADVERSARIAL_GUARD_FILE = 'suite.test.ts';

export const SCORECARD_PATH = join(CORE_DIR, 'SCORECARD.md');

/** How one case came back from the run. `not-run` is a failure, not a gap. */
export type CaseResult = 'passed' | 'failed' | 'not-run';

export type CaseFailure = {
  id: string;
  dimension: EvalDimension;
  result: CaseResult;
  detail: string;
};

export type DimensionTally = {
  dimension: EvalDimension;
  total: number;
  passed: number;
  failed: number;
};

export type GuardTally = {
  total: number;
  passed: number;
  failures: string[];
};

/**
 * A suite's guards must have *run*. An empty tally is the fail-open shape — no
 * failures because no assertions — so absence is reported as its own breach
 * rather than read as health.
 */
function guardViolations(label: string, guards: GuardTally): string[] {
  if (guards.total === 0) {
    return [`${label} guards did not run; the scorecard cannot vouch for a suite it never saw`];
  }
  if (guards.failures.length > 0) {
    return [`${label} guards failed: ${guards.failures.join(', ')}`];
  }
  if (guards.passed !== guards.total) {
    return [`${label} guards are ${guards.passed}/${guards.total}; every guard must pass`];
  }
  return [];
}

export type AdversarialCase = {
  file: string;
  /** The validation code this case asserts, read out of its source. */
  code: string | null;
  passed: boolean;
};

export type AdversarialTally = {
  /** Numbered case files found on disk. */
  total: number;
  passed: number;
  /** One case per validation code is what "whole" means. */
  expected: number;
  cases: AdversarialCase[];
  guards: GuardTally;
};

export type Scorecard = {
  dimensions: DimensionTally[];
  total: number;
  passed: number;
  failed: number;
  failures: CaseFailure[];
  guards: GuardTally;
  adversarial: AdversarialTally;
  /** Governance suites found on disk. Non-empty means this generator owes a row. */
  governance: string[];
};

/* ------------------------------------------------------------------ vitest */

type VitestAssertion = { title: string; status: string; failureMessages?: string[] };
type VitestFile = { name: string; status: string; assertionResults?: VitestAssertion[] };
export type VitestReport = { testResults?: VitestFile[] };

/**
 * Run the named directories as one vitest process and hand back its JSON report.
 *
 * The suites import the widgets catalog through `import.meta.glob`, which only
 * resolves under vite — so this is also the only way to run them at all.
 */
export function runVitestJson(targets: readonly string[]): VitestReport {
  const require = createRequire(import.meta.url);
  const vitestBin = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

  const run = spawnSync(
    process.execPath,
    [vitestBin, 'run', ...targets, '--reporter=json', '--silent'],
    { cwd: CORE_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  const stdout = run.stdout ?? '';
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(
      `could not read a JSON report from vitest (exit ${run.status}).\n${run.stderr ?? ''}`,
    );
  }
  return JSON.parse(stdout.slice(start, end + 1)) as VitestReport;
}

function assertionsIn(report: VitestReport, file: string): VitestAssertion[] {
  const match = (report.testResults ?? []).find((item) => basename(item.name) === file);
  return match?.assertionResults ?? [];
}

/** First line of the first failure message — enough to say what broke. */
function detailOf(assertion: VitestAssertion | undefined): string {
  const raw = assertion?.failureMessages?.[0];
  if (raw === undefined || raw.trim() === '') return 'failed';
  return raw.split('\n')[0].trim();
}

/* -------------------------------------------------------------------- eval */

/** Every fixture on disk, as { id, dimension } — parsed by the suite's parser. */
export function readEvalFixtures(dir: string = EVAL_CASES_DIR): { id: string; dimension: EvalDimension }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const parsed = parseEvalCase(JSON.parse(readFileSync(join(dir, name), 'utf8')), name);
      return { id: parsed.id, dimension: parsed.dimension };
    });
}

/**
 * Tally the eval set by dimension, taking each case's verdict from the run.
 *
 * The tally is seeded from the closed enum, not from the cases on disk, so a
 * dimension that has lost all its fixtures shows up as 0 and trips the floor
 * rather than quietly vanishing from the table.
 */
export function collectEval(
  report: VitestReport,
  dir: string = EVAL_CASES_DIR,
): Omit<Scorecard, 'adversarial' | 'governance'> {
  const fixtures = readEvalFixtures(dir);
  const assertions = assertionsIn(report, EVAL_TEST_FILE);
  const byTitle = new Map(assertions.map((item) => [item.title, item]));
  const caseIds = new Set(fixtures.map((item) => item.id));

  const byDimension = new Map<EvalDimension, DimensionTally>(
    EVAL_DIMENSIONS.map((dimension) => [dimension, { dimension, total: 0, passed: 0, failed: 0 }]),
  );
  const failures: CaseFailure[] = [];

  for (const fixture of fixtures) {
    const tally = byDimension.get(fixture.dimension);
    if (tally === undefined) continue; // parseEvalCase already closed this set.
    tally.total += 1;

    const assertion = byTitle.get(fixture.id);
    const result: CaseResult =
      assertion === undefined ? 'not-run' : assertion.status === 'passed' ? 'passed' : 'failed';

    if (result === 'passed') {
      tally.passed += 1;
    } else {
      tally.failed += 1;
      failures.push({
        id: fixture.id,
        dimension: fixture.dimension,
        result,
        detail: result === 'not-run' ? 'the suite reported no result for this case' : detailOf(assertion),
      });
    }
  }

  // Everything in the eval file that is not a case is a guard on the suite itself.
  const guardAssertions = assertions.filter((item) => !caseIds.has(item.title));
  const dimensions = [...byDimension.values()];

  return {
    dimensions,
    total: sum(dimensions, (item) => item.total),
    passed: sum(dimensions, (item) => item.passed),
    failed: sum(dimensions, (item) => item.failed),
    failures,
    guards: tallyGuards(guardAssertions),
  };
}

function tallyGuards(assertions: readonly VitestAssertion[]): GuardTally {
  return {
    total: assertions.length,
    passed: assertions.filter((item) => item.status === 'passed').length,
    failures: assertions.filter((item) => item.status !== 'passed').map((item) => item.title),
  };
}

/* ------------------------------------------------------------- adversarial */

/**
 * Tally tests/adversarial from the run.
 *
 * Case files are `NN-slug.test.ts` and each asserts exactly one validation code
 * — the same convention suite.test.ts enforces — so the code column is read out
 * of the source rather than kept in a table here that could drift.
 */
export function collectAdversarial(report: VitestReport): AdversarialTally {
  const files = readdirSync(ADVERSARIAL_DIR)
    .filter((name) => /^\d{2}-.+\.test\.ts$/.test(name))
    .sort();

  const cases = files.map((file) => {
    const assertions = assertionsIn(report, file);
    return {
      file,
      code: codeAssertedBy(file),
      // No assertions means the file never ran — not a pass.
      passed: assertions.length > 0 && assertions.every((item) => item.status === 'passed'),
    };
  });

  return {
    total: files.length,
    passed: cases.filter((item) => item.passed).length,
    expected: VALIDATION_CODES.length,
    cases,
    guards: tallyGuards(assertionsIn(report, ADVERSARIAL_GUARD_FILE)),
  };
}

/** The one validation code quoted in a case's source, or null if it is not exactly one. */
function codeAssertedBy(file: string): string | null {
  const body = readFileSync(join(ADVERSARIAL_DIR, file), 'utf8');
  const found = VALIDATION_CODES.filter((code) => body.includes(`'${code}'`));
  return found.length === 1 ? found[0] : null;
}

/* -------------------------------------------------------------- governance */

const TESTS_DIR = join(CORE_DIR, 'tests');

/**
 * Governance suites (S4-11) on disk, if any have landed.
 *
 * The "not measured here" note is a claim about the repo, so it has to be
 * checked against the repo. The moment a governance suite exists, this
 * generator is out of date by definition — it has no row for it — and saying so
 * is a breach rather than a paragraph that quietly goes stale.
 */
export function governanceSuites(dir: string = TESTS_DIR): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const next = join(at, entry.name);
      // The adversarial gate is not the S4-11 suite, even when its name says governance.
      if (entry.isDirectory()) {
        if (entry.name === 'adversarial') continue;
        walk(next);
        continue;
      }
      if (!entry.name.endsWith('.test.ts')) continue;
      const relative = next.slice(dir.length + 1);
      const parts = relative.split(/[/\\]/);
      const inGovernanceDir = parts.slice(0, -1).some((part) => part.toLowerCase() === 'governance');
      if (inGovernanceDir || /governance/i.test(entry.name)) found.push(relative);
    }
  };
  walk(dir);
  return found.sort();
}

/* ------------------------------------------------------------------- card */

export type CollectOptions = {
  /** Override the fixture directory. Defaults to tests/eval/dimensions/cases. */
  cases?: string;
  /**
   * Read a vitest JSON report from disk instead of running one. CI can then run
   * the suites once, keep the report, and build the card from it.
   */
  report?: string;
};

export function collectScorecard(options: CollectOptions = {}): Scorecard {
  const report =
    options.report === undefined
      ? runVitestJson([EVAL_DIR, ADVERSARIAL_DIR])
      : (JSON.parse(readFileSync(options.report, 'utf8')) as VitestReport);
  return {
    ...collectEval(report, options.cases),
    adversarial: collectAdversarial(report),
    governance: governanceSuites(),
  };
}

/**
 * The S4-14 gate, as sentences. Empty means the scorecard may be published.
 *
 * Floors and failures are both here: a suite that shrank below the floor and a
 * suite that went red are each a reason the numbers must not be shipped.
 */
export function floorViolations(card: Scorecard): string[] {
  const problems: string[] = [];

  // Rows and totals must agree before any floor is read off them, or a floor
  // check on card.total says nothing about the table underneath it.
  problems.push(...consistencyViolations(card));

  if (card.total < TOTAL_FLOOR) {
    problems.push(`eval set holds ${card.total} cases; the floor is ${TOTAL_FLOOR}`);
  }

  for (const item of card.dimensions) {
    if (item.total < DIMENSION_FLOOR) {
      problems.push(
        `dimension "${item.dimension}" holds ${item.total} cases; the floor is ${DIMENSION_FLOOR}`,
      );
    }
  }

  if (card.failed > 0) {
    problems.push(
      `${card.failed} eval case${card.failed === 1 ? '' : 's'} did not pass: ${card.failures
        .map((item) => item.id)
        .join(', ')}`,
    );
  }

  problems.push(...guardViolations('eval suite', card.guards));

  const adversarial = card.adversarial;
  if (adversarial.total !== adversarial.expected) {
    problems.push(
      `adversarial suite has ${adversarial.total} cases for ${adversarial.expected} validation codes`,
    );
  }
  if (adversarial.passed !== adversarial.expected) {
    problems.push(
      `adversarial suite is ${adversarial.passed}/${adversarial.expected}; it must be whole`,
    );
  }
  problems.push(...codeCoverageViolations(adversarial));
  problems.push(...guardViolations('adversarial suite', adversarial.guards));

  if (card.governance.length > 0) {
    problems.push(
      `governance suites have landed (${card.governance.join(', ')}) but this generator has no row ` +
        `for them; the scorecard must stop claiming they are unmeasured`,
    );
  }

  return problems;
}

/**
 * The table must add up. Without this, a floor read off `card.total` says
 * nothing about the rows printed beneath it — the two could disagree and both
 * look fine.
 */
function consistencyViolations(card: Scorecard): string[] {
  const problems: string[] = [];
  const rows = card.dimensions;

  for (const row of rows) {
    if (row.passed + row.failed !== row.total) {
      problems.push(
        `dimension "${row.dimension}" reports ${row.passed} pass + ${row.failed} fail for ${row.total} cases`,
      );
    }
  }

  const checks: [string, number, number][] = [
    ['total', card.total, sum(rows, (row) => row.total)],
    ['passed', card.passed, sum(rows, (row) => row.passed)],
    ['failed', card.failed, sum(rows, (row) => row.failed)],
  ];
  for (const [label, claimed, actual] of checks) {
    if (claimed !== actual) {
      problems.push(`card ${label} is ${claimed}; the dimension rows sum to ${actual}`);
    }
  }

  if (card.failures.length !== card.failed) {
    problems.push(
      `card reports ${card.failed} failed cases but lists ${card.failures.length}`,
    );
  }

  return problems;
}

/**
 * Nine green files are not nine covered codes.
 *
 * Each case names the code it asserts by quoting it, so the suite can be whole
 * by file count while several files probe the same code and others probe none.
 * The asserted codes must be the closed set exactly — this is the generator's
 * own check, not a reading of suite.test.ts, so it holds even in a report that
 * never ran the guards.
 */
function codeCoverageViolations(adversarial: AdversarialTally): string[] {
  const problems: string[] = [];

  const unreadable = adversarial.cases.filter((item) => item.code === null).map((item) => item.file);
  if (unreadable.length > 0) {
    problems.push(
      `adversarial cases assert no single validation code: ${unreadable.join(', ')}`,
    );
  }

  const asserted = adversarial.cases
    .map((item) => item.code)
    .filter((code): code is string => code !== null);

  const duplicated = [...new Set(asserted.filter((code, index) => asserted.indexOf(code) !== index))];
  if (duplicated.length > 0) {
    problems.push(`adversarial codes asserted more than once: ${duplicated.sort().join(', ')}`);
  }

  const covered = new Set(asserted);
  const uncovered = VALIDATION_CODES.filter((code) => !covered.has(code));
  if (uncovered.length > 0) {
    problems.push(`validation codes with no adversarial case: ${uncovered.join(', ')}`);
  }

  return problems;
}

/**
 * Render the scorecard.
 *
 * Deterministic on purpose: no timestamp, no commit sha, nothing but the
 * numbers. A run that changes this file changed a result, which is what makes
 * `--check` worth having in CI.
 */
export function renderScorecard(card: Scorecard): string {
  const violations = floorViolations(card);
  const adversarial = card.adversarial;
  const lines: string[] = [];

  lines.push('# UI9000 engine scorecard');
  lines.push('');
  lines.push('<!-- Generated by scripts/scorecard.ts. Do not edit by hand: run `yarn scorecard`. -->');
  lines.push('');
  lines.push(
    'Every number below is read back from one `vitest run` over `tests/eval/dimensions`',
    'and `tests/adversarial`. Nothing here is estimated or typed in.',
  );
  lines.push('');
  lines.push(`**Status: ${violations.length === 0 ? 'PASS' : 'FAIL'}**`);
  lines.push('');

  if (violations.length > 0) {
    lines.push('## Why this scorecard fails');
    lines.push('');
    for (const problem of violations) lines.push(`- ${problem}`);
    lines.push('');
  }

  lines.push('## Eval cases by dimension');
  lines.push('');
  lines.push(`Floor: ${TOTAL_FLOOR} cases in total, ${DIMENSION_FLOOR} in every dimension.`);
  lines.push('');
  lines.push('| Dimension | Cases | Pass | Fail | Floor |');
  lines.push('| --- | ---: | ---: | ---: | --- |');
  for (const item of card.dimensions) {
    lines.push(
      `| ${item.dimension} | ${item.total} | ${item.passed} | ${item.failed} | ${
        item.total < DIMENSION_FLOOR ? `**below ${DIMENSION_FLOOR}**` : `ok (>= ${DIMENSION_FLOOR})`
      } |`,
    );
  }
  lines.push(
    `| **total** | **${card.total}** | **${card.passed}** | **${card.failed}** | ${
      card.total < TOTAL_FLOOR ? `**below ${TOTAL_FLOOR}**` : `ok (>= ${TOTAL_FLOOR})`
    } |`,
  );
  lines.push('');
  lines.push(
    'Suite guards on the eval set itself (closed dimension enum, closed intents, every',
    `policy probe exercised, fixture parsing): ${guardLine(card.guards)}`,
  );
  lines.push('');

  lines.push('## Adversarial suite');
  lines.push('');
  lines.push(
    `**${adversarial.passed}/${adversarial.expected}** — one hostile spec per validation code,`,
    'each refused with the exact code before any render path is touched.',
  );
  lines.push('');
  lines.push('| Case | Validation code | Result |');
  lines.push('| --- | --- | --- |');
  for (const item of adversarial.cases) {
    lines.push(
      `| ${item.file.replace('.test.ts', '')} | \`${item.code ?? '—'}\` | ${
        item.passed ? 'refused' : '**FAILED**'
      } |`,
    );
  }
  lines.push('');
  lines.push(
    'Suite guards on the adversarial set itself (one case per code, a fixture per case,',
    `no skips, no render path): ${guardLine(adversarial.guards)}`,
  );
  lines.push('');

  if (card.failures.length > 0) {
    lines.push('## Eval cases that did not pass');
    lines.push('');
    lines.push('| Case | Dimension | Result | Detail |');
    lines.push('| --- | --- | --- | --- |');
    for (const failure of card.failures) {
      lines.push(
        `| ${failure.id} | ${failure.dimension} | ${failure.result} | ${escapeCell(failure.detail)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Not measured here');
  lines.push('');
  if (card.governance.length === 0) {
    lines.push(
      '- **Governance (S4-11).** No governance numbers are reported, because no governance',
      '  suite exists in `tests/` yet — the generator checks, rather than assuming. They are',
      '  absent rather than estimated. When S4-11 lands, this scorecard fails until it grows',
      '  a row for it, so the claim cannot go stale quietly.',
    );
  } else {
    lines.push(
      `- **Governance (S4-11) has landed** (${card.governance
        .map((file) => `\`${file}\``)
        .join(', ')}) **and is not yet tallied here.** That is why this scorecard fails: the`,
      '  generator must grow a row for it rather than leave the suite unreported.',
    );
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

/** Guards that never ran are reported as such, never as a clean 0/0. */
function guardLine(guards: GuardTally): string {
  if (guards.total === 0) return '**DID NOT RUN**';
  if (guards.passed !== guards.total) {
    return `**${guards.passed}/${guards.total} — ${guards.failures.join(', ')}**`;
  }
  return `${guards.passed}/${guards.total} pass.`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** Returns the process exit code. */
export function main(argv: readonly string[]): number {
  const check = argv.includes('--check');
  const out = valueOf(argv, '--out') ?? SCORECARD_PATH;

  const card = collectScorecard({
    ...optional('cases', valueOf(argv, '--cases')),
    ...optional('report', valueOf(argv, '--report')),
  });
  const rendered = renderScorecard(card);
  const violations = floorViolations(card);

  if (check) {
    const current = readOrNull(out);
    if (current !== rendered) {
      process.stderr.write(
        current === null
          ? `scorecard: ${out} does not exist; run \`yarn scorecard\`\n`
          : `scorecard: ${out} is out of date; run \`yarn scorecard\`\n`,
      );
      for (const problem of violations) process.stderr.write(`scorecard: ${problem}\n`);
      return 1;
    }
    process.stdout.write(`scorecard: ${out} is up to date\n`);
  } else {
    writeFileSync(out, rendered);
    process.stdout.write(`scorecard: wrote ${out}\n`);
  }

  process.stdout.write(
    `scorecard: ${card.passed}/${card.total} eval cases, ` +
      `adversarial ${card.adversarial.passed}/${card.adversarial.expected}\n`,
  );

  for (const problem of violations) process.stderr.write(`scorecard: ${problem}\n`);
  return violations.length === 0 ? 0 : 1;
}

function optional<K extends string>(key: K, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

/**
 * The value after `flag`, or undefined if the flag is absent.
 *
 * A flag with nothing after it, or with another flag after it, is an error
 * rather than a silent fallback: `--report` with no path used to fall through
 * to a live run, and `--report --check` used to treat `--check` as a file name.
 */
function valueOf(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

/** The file's contents, or null only when it genuinely is not there. */
function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  }
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}

/* c8 ignore start — CLI entry. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
/* c8 ignore stop */
