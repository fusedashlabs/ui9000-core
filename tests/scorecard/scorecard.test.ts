/**
 * S4-14 / FUS-4119 — the gate on the scorecard generator.
 *
 * Two things are under test, and they are different things.
 *
 * 1. The floors. The generator must refuse to bless an eval set that has shrunk
 *    below 50 cases in total or 8 in any one dimension, and an adversarial suite
 *    that is not whole. These are tested on the rule itself and then end to end
 *    through `main`, because "the script fails" is the requirement — a
 *    `floorViolations` array nobody acts on would not be one.
 *
 * 2. That the numbers are read, not written. The counts in SCORECARD.md must
 *    equal what the fixtures on disk and a test run actually say, so the file is
 *    checked against a fresh render rather than eyeballed.
 *
 * The end-to-end cases drive `main` with `--report`, handing it a vitest report
 * built here. That keeps them honest about the CLI's real code path — argument
 * parsing, rendering, exit code — without nesting a vitest run inside this one.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { VALIDATION_CODES } from '../../src/validate/codes.js';
import { EVAL_DIMENSIONS, type EvalDimension } from '../eval/dimensions/dimensions.js';
import {
  collectEval,
  DIMENSION_FLOOR,
  floorViolations,
  governanceSuites,
  main,
  readEvalFixtures,
  renderScorecard,
  SCORECARD_PATH,
  TOTAL_FLOOR,
  type Scorecard,
  type VitestReport,
} from '../../scripts/scorecard.js';

const ADVERSARIAL_DIR = fileURLToPath(new URL('../adversarial/', import.meta.url));

/* ----------------------------------------------------------------- helpers */

/**
 * A card that clears every floor, for the negative cases to bend one field of.
 *
 * Totals are always derived from the rows, never passed in beside them: a
 * helper that let the two drift would build a card the generator cannot
 * produce, and would hide the consistency rule instead of exercising it.
 */
function cardWith(
  totals: Partial<Record<EvalDimension, number>> = {},
  overrides: Partial<Scorecard> = {},
): Scorecard {
  const dimensions = EVAL_DIMENSIONS.map((dimension) => {
    const total = totals[dimension] ?? 12;
    return { dimension, total, passed: total, failed: 0 };
  });
  return {
    dimensions,
    total: dimensions.reduce((sum, item) => sum + item.total, 0),
    passed: dimensions.reduce((sum, item) => sum + item.passed, 0),
    failed: dimensions.reduce((sum, item) => sum + item.failed, 0),
    failures: [],
    guards: { total: 17, passed: 17, failures: [] },
    adversarial: wholeAdversarial(),
    governance: [],
    ...overrides,
  };
}

function healthy(overrides: Partial<Scorecard> = {}): Scorecard {
  return cardWith({}, overrides);
}

/** An adversarial tally that is whole: one passing case per validation code. */
function wholeAdversarial(): Scorecard['adversarial'] {
  const files = adversarialFiles();
  return {
    total: files.length,
    passed: files.length,
    expected: VALIDATION_CODES.length,
    cases: files.map((file, index) => ({ file, code: VALIDATION_CODES[index], passed: true })),
    guards: { total: 5, passed: 5, failures: [] },
  };
}

/** One dimension resized; rows and totals stay in sync via cardWith. */
function withDimension(dimension: EvalDimension, total: number): Scorecard {
  return cardWith({ [dimension]: total });
}

/**
 * A vitest report in which every named case, and every real adversarial file,
 * passed — including the suite guards both files carry.
 *
 * The guards are the point: a report without them is the fail-open shape (no
 * failures because nothing ran), so the default helper has to look like a real
 * run. Tests that want the absent-guard shape strip them deliberately.
 */
function reportFor(
  caseIds: readonly string[],
  options: { evalGuards?: number; adversarialGuards?: number } = {},
): VitestReport {
  const evalGuards = options.evalGuards ?? 4;
  const adversarialGuards = options.adversarialGuards ?? 5;

  return {
    testResults: [
      {
        name: '/repo/tests/eval/dimensions/dimensions.test.ts',
        status: 'passed',
        assertionResults: [
          // Guards first, exactly as the real file orders them.
          ...guardAssertions('eval guard', evalGuards),
          ...caseIds.map((title) => ({ title, status: 'passed' })),
        ],
      },
      ...(adversarialGuards === 0
        ? []
        : [
            {
              name: '/repo/tests/adversarial/suite.test.ts',
              status: 'passed',
              assertionResults: guardAssertions('adversarial guard', adversarialGuards),
            },
          ]),
      ...adversarialFiles().map((name) => ({
        name: `/repo/tests/adversarial/${name}`,
        status: 'passed',
        assertionResults: [{ title: 'refuses', status: 'passed' }],
      })),
    ],
  };
}

function guardAssertions(label: string, count: number): { title: string; status: string }[] {
  return Array.from({ length: count }, (_unused, index) => ({
    title: `${label} ${index}`,
    status: 'passed',
  }));
}

/** The adversarial case files that really exist — the report must name these. */
function adversarialFiles(): string[] {
  return readdirSync(ADVERSARIAL_DIR)
    .filter((name) => /^\d{2}-.+\.test\.ts$/.test(name))
    .sort();
}

/** Write `fixtures` into a throwaway cases directory and hand back its path. */
function casesDirWith(fixtures: readonly { id: string; dimension: EvalDimension }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-cases-'));
  for (const fixture of fixtures) {
    writeFileSync(
      join(dir, `${fixture.id}.json`),
      `${JSON.stringify(
        {
          id: fixture.id,
          dimension: fixture.dimension,
          intent: 'comparison',
          profile: 'category-metric',
          expect: expectFor(fixture.dimension),
        },
        null,
        2,
      )}\n`,
    );
  }
  return dir;
}

function expectFor(dimension: EvalDimension): Record<string, unknown> {
  switch (dimension) {
    case 'selection':
      return { winner: 'bar-chart' };
    case 'schema':
      return { component: 'bar-chart' };
    case 'data_accuracy':
      return { rowCount: 4 };
    case 'a11y':
      return { label: 'bar-chart' };
    case 'policy':
      return { probe: 'none', refusalCode: null };
  }
}

/** Run the CLI against a synthetic set, capturing what it wrote. */
function runCli(
  fixtures: readonly { id: string; dimension: EvalDimension }[],
  options: { evalGuards?: number; adversarialGuards?: number } = {},
): { code: number; stderr: string; markdown: string } {
  const dir = casesDirWith(fixtures);
  // Kept out of `dir`: the cases directory must hold nothing but fixtures.
  const work = mkdtempSync(join(tmpdir(), 'scorecard-run-'));
  const reportPath = join(work, 'report.json');
  writeFileSync(
    reportPath,
    JSON.stringify(reportFor(fixtures.map((item) => item.id), options)),
  );
  const out = join(work, 'SCORECARD.md');

  const stderr: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  const quiet = process.stdout.write.bind(process.stdout);
  process.stderr.write = ((chunk: string) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;

  try {
    const code = main(['--cases', dir, '--report', reportPath, '--out', out]);
    return { code, stderr: stderr.join(''), markdown: readFileSync(out, 'utf8') };
  } finally {
    process.stderr.write = write;
    process.stdout.write = quiet;
  }
}

/** `count` fixtures spread evenly across the five dimensions. */
function spread(count: number): { id: string; dimension: EvalDimension }[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `case-${String(index).padStart(3, '0')}`,
    dimension: EVAL_DIMENSIONS[index % EVAL_DIMENSIONS.length],
  }));
}

/* ------------------------------------------------------------------- tests */

describe('floors', () => {
  it('passes a set that clears every floor', () => {
    expect(floorViolations(healthy())).toEqual([]);
  });

  it('fails when the whole set is below the total floor', () => {
    const card = healthy({ total: TOTAL_FLOOR - 1 });
    expect(floorViolations(card)).toContain(
      `eval set holds ${TOTAL_FLOOR - 1} cases; the floor is ${TOTAL_FLOOR}`,
    );
  });

  it('accepts a set exactly on the total floor', () => {
    // 10 per dimension is 50 — on the floor, with rows that really sum to it.
    const card = cardWith(Object.fromEntries(EVAL_DIMENSIONS.map((item) => [item, 10])));
    expect(card.total).toBe(TOTAL_FLOOR);
    expect(floorViolations(card)).toEqual([]);
  });

  it('fails when any one dimension is below the dimension floor', () => {
    for (const dimension of EVAL_DIMENSIONS) {
      const card = withDimension(dimension, DIMENSION_FLOOR - 1);
      expect(floorViolations(card), dimension).toContain(
        `dimension "${dimension}" holds ${DIMENSION_FLOOR - 1} cases; the floor is ${DIMENSION_FLOOR}`,
      );
    }
  });

  it('accepts a dimension exactly on its floor', () => {
    const card = withDimension('a11y', DIMENSION_FLOOR);
    expect(floorViolations(card)).toEqual([]);
  });

  it('fails a dimension that has lost every case, rather than dropping it', () => {
    const card = withDimension('policy', 0);
    expect(floorViolations(card)).toContain(
      `dimension "policy" holds 0 cases; the floor is ${DIMENSION_FLOOR}`,
    );
  });

  it('fails when a case did not pass', () => {
    const card = healthy({
      failed: 1,
      failures: [
        { id: 'selection-comparison-bar-chart', dimension: 'selection', result: 'failed', detail: 'boom' },
      ],
    });
    expect(floorViolations(card)).toContain(
      '1 eval case did not pass: selection-comparison-bar-chart',
    );
  });

  it('fails when the adversarial suite is not whole', () => {
    const card = healthy();
    const short = {
      ...card,
      adversarial: { ...card.adversarial, passed: card.adversarial.expected - 1 },
    };
    expect(floorViolations(short)).toContain(
      `adversarial suite is ${card.adversarial.expected - 1}/${card.adversarial.expected}; it must be whole`,
    );
  });

  it('fails when a suite guard broke', () => {
    const card = healthy({ guards: { total: 3, passed: 2, failures: ['covers all five dimensions'] } });
    expect(floorViolations(card)).toContain(
      'eval suite guards failed: covers all five dimensions',
    );
  });
});

describe('a card whose rows do not add up', () => {
  it('fails when the claimed total disagrees with the rows', () => {
    const card = healthy({ total: TOTAL_FLOOR });
    expect(floorViolations(card)).toContain(
      `card total is ${TOTAL_FLOOR}; the dimension rows sum to 60`,
    );
  });

  it('fails when a row\'s pass and fail do not add to its cases', () => {
    const card = healthy();
    const dimensions = card.dimensions.map((item, index) =>
      index === 0 ? { ...item, passed: item.total - 1 } : item,
    );
    const bent = { ...card, dimensions };
    expect(floorViolations(bent)).toContain(
      `dimension "${dimensions[0].dimension}" reports ${dimensions[0].passed} pass + 0 fail for ${dimensions[0].total} cases`,
    );
  });

  it('fails when the failed count and the listed failures disagree', () => {
    const card = healthy({ failed: 2 });
    expect(floorViolations(card)).toContain('card reports 2 failed cases but lists 0');
  });
});

describe('guards fail closed', () => {
  it('fails when the eval guards never ran, rather than reading 0/0 as health', () => {
    const card = healthy({ guards: { total: 0, passed: 0, failures: [] } });
    expect(floorViolations(card)).toContain(
      'eval suite guards did not run; the scorecard cannot vouch for a suite it never saw',
    );
  });

  it('fails when the adversarial guards never ran', () => {
    const card = healthy();
    const blind = {
      ...card,
      adversarial: { ...card.adversarial, guards: { total: 0, passed: 0, failures: [] } },
    };
    expect(floorViolations(blind)).toContain(
      'adversarial suite guards did not run; the scorecard cannot vouch for a suite it never saw',
    );
  });

  it('fails when guards ran but not all of them passed, even with no named failure', () => {
    const card = healthy({ guards: { total: 17, passed: 16, failures: [] } });
    expect(floorViolations(card)).toContain(
      'eval suite guards are 16/17; every guard must pass',
    );
  });

  it('renders an absent guard run as DID NOT RUN, never as a ratio', () => {
    const card = healthy({ guards: { total: 0, passed: 0, failures: [] } });
    const markdown = renderScorecard(card);
    expect(markdown).toContain('**DID NOT RUN**');
    expect(markdown).not.toContain('0/0');
  });
});

describe('adversarial code coverage fails closed', () => {
  it('fails when nine green files all assert the same code', () => {
    const card = healthy();
    const sameCode = {
      ...card,
      adversarial: {
        ...card.adversarial,
        cases: card.adversarial.cases.map((item) => ({ ...item, code: 'unknown_component' })),
      },
    };
    const problems = floorViolations(sameCode);
    // Whole by file count and pass count, yet eight codes are unprobed.
    expect(sameCode.adversarial.passed).toBe(sameCode.adversarial.expected);
    expect(problems.join('\n')).toMatch(/asserted more than once: unknown_component/);
    expect(problems.join('\n')).toMatch(/validation codes with no adversarial case: /);
  });

  it('fails when a case quotes no single validation code', () => {
    const card = healthy();
    const unreadable = {
      ...card,
      adversarial: {
        ...card.adversarial,
        cases: card.adversarial.cases.map((item, index) =>
          index === 0 ? { ...item, code: null } : item,
        ),
      },
    };
    expect(floorViolations(unreadable).join('\n')).toMatch(
      /adversarial cases assert no single validation code: /,
    );
  });

  it('names every uncovered code', () => {
    const card = healthy();
    const short = {
      ...card,
      adversarial: { ...card.adversarial, cases: card.adversarial.cases.slice(0, 3) },
    };
    const problems = floorViolations(short).join('\n');
    for (const code of VALIDATION_CODES.slice(3)) {
      expect(problems, code).toContain(code);
    }
  });
});

describe('governance cannot go stale quietly', () => {
  it('fails once a governance suite lands with no row for it', () => {
    const card = healthy({ governance: ['governance/governance-no-render.test.ts'] });
    expect(floorViolations(card).join('\n')).toMatch(
      /governance suites have landed \(governance\/governance-no-render\.test\.ts\) but this generator has no row/,
    );
  });

  it('says so in the file instead of claiming the suite is unmeasured', () => {
    const markdown = renderScorecard(healthy({ governance: ['governance/x.test.ts'] }));
    expect(markdown).toContain('**Governance (S4-11) has landed**');
    expect(markdown).not.toContain('No governance numbers are reported');
  });

  it('finds a governance suite on disk when there is one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scorecard-gov-'));
    expect(governanceSuites(dir)).toEqual([]);
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'governance-no-render.test.ts'), 'it("x", () => {});\n');
    expect(governanceSuites(dir)).toEqual([join('nested', 'governance-no-render.test.ts')]);

    mkdirSync(join(dir, 'governance'));
    writeFileSync(join(dir, 'governance', 'suite.test.ts'), 'it("x", () => {});\n');
    mkdirSync(join(dir, 'adversarial'));
    writeFileSync(join(dir, 'adversarial', 'governance-no-render.test.ts'), 'it("x", () => {});\n');
    expect(governanceSuites(dir)).toEqual([
      join('governance', 'suite.test.ts'),
      join('nested', 'governance-no-render.test.ts'),
    ]);
  });

  it('reports none while none has landed — checked, not assumed', () => {
    expect(governanceSuites()).toEqual([]);
  });
});

describe('flag parsing', () => {
  it('refuses a flag with no value instead of silently running live', () => {
    expect(() => main(['--report'])).toThrow(/--report needs a value/);
  });

  it('refuses a flag followed by another flag', () => {
    expect(() => main(['--report', '--check'])).toThrow(/--report needs a value/);
  });
});

describe('the script fails on a breached floor', () => {
  it('exits non-zero when the set is below the total floor', () => {
    const run = runCli(spread(TOTAL_FLOOR - 5));
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(new RegExp(`eval set holds ${TOTAL_FLOOR - 5} cases`));
  });

  it('prints the floor breach on --check even when the file is already stale', () => {
    const fixtures = spread(TOTAL_FLOOR - 5);
    const dir = casesDirWith(fixtures);
    const work = mkdtempSync(join(tmpdir(), 'scorecard-check-'));
    const reportPath = join(work, 'report.json');
    writeFileSync(reportPath, JSON.stringify(reportFor(fixtures.map((item) => item.id))));
    const out = join(work, 'SCORECARD.md');
    writeFileSync(out, '# stale\n');

    const stderr: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    const quiet = process.stdout.write.bind(process.stdout);
    process.stderr.write = ((chunk: string) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      const code = main(['--check', '--cases', dir, '--report', reportPath, '--out', out]);
      expect(code).toBe(1);
      const text = stderr.join('');
      expect(text).toMatch(/out of date/);
      expect(text).toMatch(new RegExp(`eval set holds ${TOTAL_FLOOR - 5} cases`));
      expect(readFileSync(out, 'utf8')).toBe('# stale\n');
    } finally {
      process.stderr.write = write;
      process.stdout.write = quiet;
    }
  });

  it('exits non-zero when one dimension is below its floor', () => {
    // Every dimension well clear of its floor, except a11y with a single case.
    const fixtures = [
      ...EVAL_DIMENSIONS.filter((dimension) => dimension !== 'a11y').flatMap((dimension) =>
        Array.from({ length: 15 }, (_unused, index) => ({
          id: `${dimension}-${index}`,
          dimension,
        })),
      ),
      { id: 'a11y-only-one', dimension: 'a11y' as EvalDimension },
    ];
    const run = runCli(fixtures);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/dimension "a11y" holds 1 cases/);
    // The total floor is clear, so the dimension is the only complaint.
    expect(run.stderr).not.toMatch(/eval set holds/);
  });

  it('exits non-zero when the report carries no eval guards', () => {
    const run = runCli(spread(60), { evalGuards: 0 });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/eval suite guards did not run/);
  });

  it('exits non-zero when the report never ran the adversarial guard file', () => {
    const run = runCli(spread(60), { adversarialGuards: 0 });
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/adversarial suite guards did not run/);
  });

  it('exits zero and writes the file when every floor is clear', () => {
    const run = runCli(spread(60));
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.markdown).toContain('**Status: PASS**');
  });

  it('records the breach in the file it writes, not only on stderr', () => {
    const run = runCli(spread(TOTAL_FLOOR - 5));
    expect(run.markdown).toContain('**Status: FAIL**');
    expect(run.markdown).toContain('## Why this scorecard fails');
    expect(run.markdown).toContain(`eval set holds ${TOTAL_FLOOR - 5} cases`);
  });
});

describe('the numbers are read, not written', () => {
  it('counts a case as failed when the run never reported it', () => {
    const fixtures = spread(60);
    const dir = casesDirWith(fixtures);
    // A report that is missing one case the fixtures claim.
    const report = reportFor(fixtures.slice(1).map((item) => item.id));
    const card = {
      ...collectEval(report, dir),
      adversarial: wholeAdversarial(),
      governance: [],
    };

    expect(card.failed).toBe(1);
    expect(card.failures[0]).toMatchObject({ id: fixtures[0].id, result: 'not-run' });
    expect(floorViolations(card)).toContain(`1 eval case did not pass: ${fixtures[0].id}`);
  });

  it('counts a case as failed when the run reported it failed', () => {
    const fixtures = spread(60);
    const dir = casesDirWith(fixtures);
    const report = reportFor(fixtures.map((item) => item.id));
    const assertions = report.testResults![0].assertionResults!;
    const bent = assertions.findIndex((item) => item.title === fixtures[0].id);
    assertions[bent] = {
      title: fixtures[0].id,
      status: 'failed',
      failureMessages: ['AssertionError: winner is "table"\n  at foo'],
    };

    const card = {
      ...collectEval(report, dir),
      adversarial: wholeAdversarial(),
      governance: [],
    };
    expect(card.failed).toBe(1);
    expect(card.failures[0].detail).toBe('AssertionError: winner is "table"');
  });

  it('renders the same file twice — no timestamp, no drift', () => {
    const card = healthy();
    expect(renderScorecard(card)).toBe(renderScorecard(card));
  });
});

describe('the committed SCORECARD.md', () => {
  const committed = readFileSync(SCORECARD_PATH, 'utf8');
  const fixtures = readEvalFixtures();

  it('describes an eval set that clears the floors', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(TOTAL_FLOOR);
    for (const dimension of EVAL_DIMENSIONS) {
      const held = fixtures.filter((item) => item.dimension === dimension).length;
      expect(held, dimension).toBeGreaterThanOrEqual(DIMENSION_FLOOR);
    }
  });

  /**
   * The point of S4-14: the counts in the file are the fixtures on disk. Typing
   * a number into SCORECARD.md by hand, or letting it go stale after cases move,
   * fails here — which is what "generated, not handwritten" has to mean.
   */
  it('reports the dimension counts the fixtures actually hold', () => {
    for (const dimension of EVAL_DIMENSIONS) {
      const held = fixtures.filter((item) => item.dimension === dimension).length;
      expect(rowFor(committed, dimension).cases, dimension).toBe(held);
    }
    expect(rowFor(committed, '**total**').cases).toBe(fixtures.length);
  });

  /**
   * Every other cell, not just `Cases`. A hand-edited Pass column used to sail
   * through: the row counts were checked and the rest was not.
   */
  it('reports Pass and Fail cells that add up, row by row and in total', () => {
    let cases = 0;
    let passed = 0;
    let failed = 0;

    for (const dimension of EVAL_DIMENSIONS) {
      const row = rowFor(committed, dimension);
      expect(row.passed + row.failed, dimension).toBe(row.cases);
      cases += row.cases;
      passed += row.passed;
      failed += row.failed;
    }

    const total = rowFor(committed, '**total**');
    expect(total.cases).toBe(cases);
    expect(total.passed).toBe(passed);
    expect(total.failed).toBe(failed);
  });

  it('states a Status that matches the table underneath it', () => {
    const failed = rowFor(committed, '**total**').failed;
    // The Floor column's breach marker, not the word "below" in the prose.
    const belowFloor = /\*\*below \d+\*\*/.test(committed);
    const clean = failed === 0 && !belowFloor;

    expect(committed).toContain(`**Status: ${clean ? 'PASS' : 'FAIL'}**`);
    // A PASS card must not also be carrying a failure section.
    if (clean) {
      expect(committed).not.toContain('## Why this scorecard fails');
      expect(committed).not.toContain('## Eval cases that did not pass');
    }
  });

  it('reports guard ratios that ran and fully passed', () => {
    const ratios = [...committed.matchAll(/(\d+)\/(\d+) pass\./g)];
    // One for the eval suite, one for the adversarial suite.
    expect(ratios).toHaveLength(2);
    for (const [, passed, total] of ratios) {
      expect(Number(total)).toBeGreaterThan(0);
      expect(Number(passed)).toBe(Number(total));
    }
    expect(committed).not.toContain('DID NOT RUN');
  });

  it('lists every adversarial case, one per validation code', () => {
    const files = adversarialFiles();
    expect(files).toHaveLength(VALIDATION_CODES.length);

    for (const file of files) {
      expect(committed, file).toContain(`| ${file.replace('.test.ts', '')} |`);
    }
    for (const code of VALIDATION_CODES) {
      expect(committed, code).toContain(`\`${code}\``);
    }
    // Every adversarial row refused; none left FAILED in a published card.
    expect(committed).not.toContain('**FAILED**');
  });

  it('carries the do-not-edit marker, so a hand edit is a mistake on its face', () => {
    expect(committed).toContain('Generated by scripts/scorecard.ts');
  });
});

/** One row of the dimension table, as numbers. */
function rowFor(markdown: string, label: string): { cases: number; passed: number; failed: number } {
  const row = markdown.split('\n').find((line) => line.startsWith(`| ${label} |`));
  if (row === undefined) throw new Error(`no row for ${label} in SCORECARD.md`);
  const cells = row.split('|').map((cell) => cell.trim().replace(/\*/g, ''));
  return { cases: Number(cells[2]), passed: Number(cells[3]), failed: Number(cells[4]) };
}
