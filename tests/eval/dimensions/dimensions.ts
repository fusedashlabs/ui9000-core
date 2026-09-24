/**
 * S4-01 / FUS-4107 — the closed five-dimension eval enum, and the parser that
 * turns one JSON fixture into a case the harness can run.
 *
 * The point of this folder is that a new eval case is *data*: a JSON file in
 * `cases/`, never a new `it()` and never a line of engine source. So the enum
 * below is the only place a dimension name exists, and everything a fixture may
 * say is checked here — an unknown dimension, an unknown `expect` key, an
 * intent outside the closed intent enum and a profile override outside the
 * closed DataProfile all fail loudly, at parse time, naming the closed set.
 *
 * Fixture shape: { id, dimension, intent, profile, expect }.
 *
 * Adding a sixth dimension is deliberately not free: it means editing
 * EVAL_DIMENSIONS, its `expect` parser, and the checker table in harness.ts —
 * three edits the type-checker forces on you at once. Adding a *case* is free.
 */

import { DATA_PROFILE_KEYS, type DataProfile } from '../../../src/spec/data-profile.js';
import { INTENTS, type Intent } from '../../../src/spec/intent.js';
import { VALIDATION_CODES, type ValidationCode } from '../../../src/validate/validate-spec.js';

/** Closed dimension enum. S4-01 must not rename or add values without the edits above. */
export const EVAL_DIMENSIONS = [
  'selection',
  'schema',
  'data_accuracy',
  'a11y',
  'policy',
] as const;

export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];

const DIMENSION_SET: ReadonlySet<string> = new Set(EVAL_DIMENSIONS);

/**
 * Closed probe set for `policy` cases. A probe is one hostile edit applied to
 * the spec the engine actually emitted for this case — so a policy fixture
 * tests the shipping path's output, not a hand-written hostile document (that
 * is tests/adversarial, and this folder does not touch it).
 */
export const POLICY_PROBES = [
  'none',
  'script-url',
  'data-url',
  'handler-prop',
  'inline-rows',
  'unknown-action',
  'unknown-component',
  'unnamed-tool',
  'unbound-field',
  'strip-label',
] as const;

export type PolicyProbe = (typeof POLICY_PROBES)[number];

const PROBE_SET: ReadonlySet<string> = new Set(POLICY_PROBES);

const INTENT_SET: ReadonlySet<string> = new Set(INTENTS);
const CODE_SET: ReadonlySet<string> = new Set(VALIDATION_CODES);
const PROFILE_KEY_SET: ReadonlySet<string> = new Set(DATA_PROFILE_KEYS);

/** Every dimension but `selection` inspects the emitted spec, which needs real columns. */
const NEEDS_DATASET: ReadonlySet<EvalDimension> = new Set<EvalDimension>([
  'schema',
  'data_accuracy',
  'a11y',
  'policy',
]);

/** A fixture the harness refuses to run. Never a silent skip. */
export class EvalFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalFixtureError';
  }
}

/**
 * Where the case's DataProfile comes from: a named fixture under
 * tests/fixtures/profiles (its CSV is profiled, and its recorded JSON is what
 * `data_accuracy` compares against), plus closed-key overrides for facts no
 * column can prove — `hasMapToken` is the host's, not the table's.
 */
export type EvalProfileRef = {
  name?: string;
  overrides: DataProfile;
};

export type IdReason = {
  id: string;
  reason: string;
};

export type SelectionExpect = {
  /** null asserts the engine picked nothing — a fail-closed outcome, not a gap. */
  winner: string | null;
  alsoEligible?: string[];
  notEligible?: string[];
  /** Winner must strictly outscore each id, and each must be eligible to lose. */
  outscores?: string[];
  rejectedWith?: IdReason[];
};

export type SchemaExpect = {
  /** Default true: show_workspace returns a spec and validateSpec accepts it. */
  specValid?: boolean;
  /** Set with specValid:false — the refusal code show_workspace answered with. */
  failCode?: string;
  component?: string;
  actions?: string[];
  bindRoles?: string[];
  fieldNames?: string[];
  closedProfileKeys?: boolean;
};

export type DataAccuracyExpect = {
  /** The CSV-derived profile equals the fixture's recorded JSON, key for key. */
  matchesRecordedProfile?: boolean;
  /** Witness keys that must equal the profile the engine saw. */
  profile?: DataProfile;
  rowCount?: number;
  columns?: string[];
  noRowsInTrace?: boolean;
  /** Rows stay behind the signed handle: no row arrays on the spec. */
  noRowsInSpec?: boolean;
  hasDataUrl?: boolean;
};

export type A11yExpect = {
  label?: string;
  everyFieldLabelled?: boolean;
  /** Declared actions are closed spec actions the winner's catalog entry allows. */
  actionsAllowedByCatalog?: boolean;
  actions?: string[];
  refusedWith?: IdReason[];
};

export type PolicyExpect = {
  probe: PolicyProbe;
  /** null asserts the probed spec is still accepted. */
  refusalCode: ValidationCode | null;
};

export type EvalExpect =
  | SelectionExpect
  | SchemaExpect
  | DataAccuracyExpect
  | A11yExpect
  | PolicyExpect;

export type EvalCase = {
  id: string;
  dimension: EvalDimension;
  intent: Intent;
  profile: EvalProfileRef;
  expect: EvalExpect;
};

const CASE_KEYS: ReadonlySet<string> = new Set(['id', 'dimension', 'intent', 'profile', 'expect']);

const EXPECT_KEYS: Record<EvalDimension, readonly string[]> = {
  selection: ['winner', 'alsoEligible', 'notEligible', 'outscores', 'rejectedWith'],
  schema: [
    'specValid',
    'failCode',
    'component',
    'actions',
    'bindRoles',
    'fieldNames',
    'closedProfileKeys',
  ],
  data_accuracy: [
    'matchesRecordedProfile',
    'profile',
    'rowCount',
    'columns',
    'noRowsInTrace',
    'noRowsInSpec',
    'hasDataUrl',
  ],
  a11y: ['label', 'everyFieldLabelled', 'actionsAllowedByCatalog', 'actions', 'refusedWith'],
  policy: ['probe', 'refusalCode'],
};

/**
 * Parse one fixture. `source` is the file name (or `inline`) and appears in
 * every message, so a bad fixture says which file to open.
 */
export function parseEvalCase(raw: unknown, source: string): EvalCase {
  const at = (what: string): string => `${source}: ${what}`;
  const body = plainObject(raw, at('fixture must be a JSON object'));
  unknownKeys(body, CASE_KEYS, at('unknown fixture key'), [...CASE_KEYS].sort());

  const id = nonEmptyString(body.id, at('id must be a non-empty string'));
  const dimension = parseDimension(body.dimension, source);
  const intent = parseIntent(body.intent, source);
  const profile = parseProfileRef(body.profile, source);
  const expect = parseExpect(dimension, body.expect, source);

  if (profile.name === undefined && NEEDS_DATASET.has(dimension)) {
    throw new EvalFixtureError(
      at(
        `dimension "${dimension}" reads the emitted spec, so profile.name must be a fixture under tests/fixtures/profiles`,
      ),
    );
  }

  return { id, dimension, intent, profile, expect };
}

/** The one check S4-01 is named for: a dimension outside the closed enum fails. */
function parseDimension(value: unknown, source: string): EvalDimension {
  const closed = EVAL_DIMENSIONS.join(' | ');
  if (typeof value !== 'string' || value === '') {
    throw new EvalFixtureError(
      `${source}: dimension must be a string, one of ${closed}; got ${describe(value)}`,
    );
  }
  if (!DIMENSION_SET.has(value)) {
    throw new EvalFixtureError(
      `${source}: dimension "${value}" is outside the closed eval enum ${closed}`,
    );
  }
  return value as EvalDimension;
}

function parseIntent(value: unknown, source: string): Intent {
  if (typeof value !== 'string' || !INTENT_SET.has(value)) {
    throw new EvalFixtureError(
      `${source}: intent must be one of ${INTENTS.join(' | ')}; got ${describe(value)}`,
    );
  }
  return value as Intent;
}

function parseProfileRef(value: unknown, source: string): EvalProfileRef {
  if (typeof value === 'string') {
    const name = nonEmptyString(value, `${source}: profile name must be non-empty`);
    return { name, overrides: {} };
  }

  const body = plainObject(value, `${source}: profile must be a fixture name or an object`);
  const overrides: DataProfile = {};
  let name: string | undefined;

  for (const [key, entry] of Object.entries(body)) {
    if (key === 'name') {
      name = nonEmptyString(entry, `${source}: profile.name must be a non-empty string`);
      continue;
    }
    if (!PROFILE_KEY_SET.has(key)) {
      throw new EvalFixtureError(
        `${source}: profile key "${key}" is outside the closed DataProfile; allowed: name, ${DATA_PROFILE_KEYS.join(', ')}`,
      );
    }
    if (typeof entry !== 'boolean' && typeof entry !== 'number') {
      throw new EvalFixtureError(
        `${source}: profile.${key} must be a boolean or number; got ${describe(entry)}`,
      );
    }
    (overrides as Record<string, unknown>)[key] = entry;
  }

  if (name === undefined && Object.keys(overrides).length === 0) {
    throw new EvalFixtureError(`${source}: profile must name a fixture or set at least one key`);
  }

  return { ...(name === undefined ? {} : { name }), overrides };
}

function parseExpect(dimension: EvalDimension, value: unknown, source: string): EvalExpect {
  const allowed = EXPECT_KEYS[dimension];
  const body = plainObject(value, `${source}: expect must be an object`);
  unknownKeys(
    body,
    new Set(allowed),
    `${source}: unknown expect key for dimension "${dimension}"`,
    allowed,
  );
  if (Object.keys(body).length === 0) {
    throw new EvalFixtureError(
      `${source}: expect is empty; a case must assert something. Keys for "${dimension}": ${allowed.join(', ')}`,
    );
  }

  switch (dimension) {
    case 'selection':
      return parseSelection(body, source);
    case 'schema':
      return parseSchema(body, source);
    case 'data_accuracy':
      return parseDataAccuracy(body, source);
    case 'a11y':
      return parseA11y(body, source);
    case 'policy':
      return parsePolicy(body, source);
  }
}

function parseSelection(body: Record<string, unknown>, source: string): SelectionExpect {
  if (!('winner' in body)) {
    throw new EvalFixtureError(`${source}: selection expect requires "winner" (a component id or null)`);
  }
  const winner =
    body.winner === null ? null : nonEmptyString(body.winner, `${source}: expect.winner must be a component id or null`);
  return {
    winner,
    ...optional('alsoEligible', ids(body.alsoEligible, `${source}: expect.alsoEligible`)),
    ...optional('notEligible', ids(body.notEligible, `${source}: expect.notEligible`)),
    ...optional('outscores', ids(body.outscores, `${source}: expect.outscores`)),
    ...optional('rejectedWith', idReasons(body.rejectedWith, `${source}: expect.rejectedWith`)),
  };
}

function parseSchema(body: Record<string, unknown>, source: string): SchemaExpect {
  const specValid = bool(body.specValid, `${source}: expect.specValid`);
  const failCode = str(body.failCode, `${source}: expect.failCode`);
  if (failCode !== undefined && specValid !== false) {
    throw new EvalFixtureError(`${source}: expect.failCode needs "specValid": false`);
  }
  return {
    ...optional('specValid', specValid),
    ...optional('failCode', failCode),
    ...optional('component', str(body.component, `${source}: expect.component`)),
    ...optional('actions', ids(body.actions, `${source}: expect.actions`)),
    ...optional('bindRoles', ids(body.bindRoles, `${source}: expect.bindRoles`)),
    ...optional('fieldNames', ids(body.fieldNames, `${source}: expect.fieldNames`)),
    ...optional('closedProfileKeys', bool(body.closedProfileKeys, `${source}: expect.closedProfileKeys`)),
  };
}

function parseDataAccuracy(body: Record<string, unknown>, source: string): DataAccuracyExpect {
  return {
    ...optional(
      'matchesRecordedProfile',
      bool(body.matchesRecordedProfile, `${source}: expect.matchesRecordedProfile`),
    ),
    ...optional('profile', profileWitness(body.profile, source)),
    ...optional('rowCount', num(body.rowCount, `${source}: expect.rowCount`)),
    ...optional('columns', ids(body.columns, `${source}: expect.columns`)),
    ...optional('noRowsInTrace', bool(body.noRowsInTrace, `${source}: expect.noRowsInTrace`)),
    ...optional('noRowsInSpec', bool(body.noRowsInSpec, `${source}: expect.noRowsInSpec`)),
    ...optional('hasDataUrl', bool(body.hasDataUrl, `${source}: expect.hasDataUrl`)),
  };
}

function parseA11y(body: Record<string, unknown>, source: string): A11yExpect {
  return {
    ...optional('label', str(body.label, `${source}: expect.label`)),
    ...optional('everyFieldLabelled', bool(body.everyFieldLabelled, `${source}: expect.everyFieldLabelled`)),
    ...optional(
      'actionsAllowedByCatalog',
      bool(body.actionsAllowedByCatalog, `${source}: expect.actionsAllowedByCatalog`),
    ),
    ...optional('actions', ids(body.actions, `${source}: expect.actions`)),
    ...optional('refusedWith', idReasons(body.refusedWith, `${source}: expect.refusedWith`)),
  };
}

function parsePolicy(body: Record<string, unknown>, source: string): PolicyExpect {
  const probe = body.probe;
  if (typeof probe !== 'string' || !PROBE_SET.has(probe)) {
    throw new EvalFixtureError(
      `${source}: expect.probe must be one of ${POLICY_PROBES.join(' | ')}; got ${describe(probe)}`,
    );
  }
  if (!('refusalCode' in body)) {
    throw new EvalFixtureError(
      `${source}: policy expect requires "refusalCode" (a validation code, or null to assert the probe is accepted)`,
    );
  }
  const code = body.refusalCode;
  if (code !== null && (typeof code !== 'string' || !CODE_SET.has(code))) {
    throw new EvalFixtureError(
      `${source}: expect.refusalCode must be null or one of ${VALIDATION_CODES.join(' | ')}; got ${describe(code)}`,
    );
  }
  return { probe: probe as PolicyProbe, refusalCode: code as ValidationCode | null };
}

function profileWitness(value: unknown, source: string): DataProfile | undefined {
  if (value === undefined) return undefined;
  const body = plainObject(value, `${source}: expect.profile must be an object`);
  const witness: DataProfile = {};
  for (const [key, entry] of Object.entries(body)) {
    if (!PROFILE_KEY_SET.has(key)) {
      throw new EvalFixtureError(
        `${source}: expect.profile key "${key}" is outside the closed DataProfile; allowed: ${DATA_PROFILE_KEYS.join(', ')}`,
      );
    }
    if (typeof entry !== 'boolean' && typeof entry !== 'number') {
      throw new EvalFixtureError(
        `${source}: expect.profile.${key} must be a boolean or number; got ${describe(entry)}`,
      );
    }
    (witness as Record<string, unknown>)[key] = entry;
  }
  if (Object.keys(witness).length === 0) {
    throw new EvalFixtureError(`${source}: expect.profile must witness at least one key`);
  }
  return witness;
}


function optional<K extends string, V>(key: K, value: V | undefined): Record<string, never> | { [P in K]: V } {
  return value === undefined ? ({} as Record<string, never>) : ({ [key]: value } as { [P in K]: V });
}

function plainObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvalFixtureError(`${message}; got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function unknownKeys(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  message: string,
  listed: readonly string[],
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new EvalFixtureError(`${message}: "${key}"; allowed: ${listed.join(', ')}`);
    }
  }
}

function nonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EvalFixtureError(`${message}; got ${describe(value)}`);
  }
  return value;
}

function str(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return nonEmptyString(value, `${label} must be a non-empty string`);
}

function bool(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new EvalFixtureError(`${label} must be a boolean; got ${describe(value)}`);
  }
  return value;
}

function num(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EvalFixtureError(`${label} must be a finite number; got ${describe(value)}`);
  }
  return value;
}

function ids(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new EvalFixtureError(`${label} must be an array of strings; got ${describe(value)}`);
  }
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}] must be a non-empty string`));
}

function idReasons(value: unknown, label: string): IdReason[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new EvalFixtureError(`${label} must be an array of { id, reason }; got ${describe(value)}`);
  }
  return value.map((item, index) => {
    const body = plainObject(item, `${label}[${index}] must be an object`);
    unknownKeys(body, new Set(['id', 'reason']), `${label}[${index}] unknown key`, ['id', 'reason']);
    return {
      id: nonEmptyString(body.id, `${label}[${index}].id must be a non-empty string`),
      reason: nonEmptyString(body.reason, `${label}[${index}].reason must be a non-empty string`),
    };
  });
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  return JSON.stringify(value) ?? String(value);
}
