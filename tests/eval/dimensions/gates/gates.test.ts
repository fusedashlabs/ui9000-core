import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { validateSpec } from '../../../../src/validate/validate-spec.js';
import { checkEvalRun, catalog, loadEvalCases, runEvalCase } from '../harness.js';

const cases = loadEvalCases();

describe('eval gates', () => {
  it('does not record a held action as a rendered execution', async () => {
    let held = 0;
    for (const evalCase of cases) {
      const run = await runEvalCase(evalCase);
      if (!run.shown?.ok) continue;
      if (!run.shown.trace.risk.some((item) => item.band === 'held')) continue;
      held += 1;
      expect(run.shown.trace.outcome, evalCase.id).toBe('held');
    }
    expect(held).toBeGreaterThan(0);
  });

  it('names the inspector and a held approval, and still refuses an unlabelled control', async () => {
    const inspector = JSON.parse(
      readFileSync(
        new URL(
          '../../../../vendor/ui9000-widgets/src/components/inspector/metadata.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { accessibility?: { nameFrom?: string } };
    expect(inspector.accessibility?.nameFrom?.trim().length).toBeGreaterThan(0);

    const approval = cases.find(
      (item) => item.id === 'a11y-incidents-approval-bar-offers-approve-and-reject',
    );
    expect(approval).toBeDefined();
    const run = await runEvalCase(approval!);
    expect(run.shown?.ok).toBe(true);
    expect(run.spec?.label).toBe('approval-bar');
    if (run.shown?.ok) {
      expect(run.shown.trace.outcome).toBe('held');
    }

    const hostile = validateSpec({ component: 'text-input', props: {} }, catalog);
    expect(hostile).toMatchObject({ ok: false, code: 'unlabelled_control' });
  });

  it('reuses decide and validateSpec on the selection and schema fixtures', async () => {
    const picked = cases.filter(
      (item) => item.dimension === 'selection' || item.dimension === 'schema',
    );
    expect(picked.length).toBeGreaterThanOrEqual(8);
    for (const evalCase of picked) {
      const run = await runEvalCase(evalCase);
      expect(checkEvalRun(run), evalCase.id).toEqual([]);
      if (evalCase.dimension === 'schema' && run.spec) {
        expect(validateSpec(run.spec, catalog).ok, evalCase.id).toBe(true);
      }
    }
  });
});
