/**
 * Eval: one dataset, four intents, four distinct workspaces.
 *
 * The whole point of a decision engine is that the objective, not the dataset,
 * picks the component. So this suite holds the dataset still — one CSV, one
 * recorded DataProfile — and varies only `intent`. A `decide` that quietly
 * collapsed to "always bar-chart" would still pass a per-component unit test;
 * it fails here, in three of the four intent cases at once.
 *
 * The dataset is built so every one of the four intents has something real to
 * win with, and so more than one component is in the running each time:
 *   spatial    — a `country` region id (map-chart)
 *   comparison — `team` × `incidents` (bar-chart against histogram-chart)
 *   summary    — ten tabular rows plus a metric (kpi-widget against table)
 *   form       — a unique `id` to approve or reject (approval-bar)
 *
 * Each intent also snapshots its trace, so a scoring change shows up as a diff
 * of the reasoning — candidates and scores, rejections and their sentences,
 * the winner's actions, the tie-break — and not just as a changed winner.
 *
 * Scope: no evidence / graph intent here; those datasets are their own fixture.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadWorkspaceCatalog } from '../../src/catalog/load-workspace.js';
import { decide } from '../../src/engine/decide.js';
import type { EngineDecision } from '../../src/engine/types.js';
import { profileColumns, type ProfileEnv } from '../../src/profiler/profile-columns.js';
import { parseCsvTable } from '../../src/profiler/table.js';
import { DATA_PROFILE_KEYS, type DataProfile } from '../../src/spec/data-profile.js';
import type { Intent } from '../../src/spec/intent.js';
import { SPEC_ACTION_SET } from '../../src/spec/workspace-spec.js';
import { assertTraceHasNoRows } from '../../src/trace/trace.js';

const DATASET = 'regional-incidents';
const DATASET_DIR = fileURLToPath(new URL('../fixtures/datasets/', import.meta.url));

/** The Mapbox token is a host capability; no column can prove it. */
const HOST: ProfileEnv = { hasMapToken: true };

/** The four intents under eval, in objective order. */
const OBJECTIVES = [
  'spatial',
  'comparison',
  'summary',
  'form',
] as const satisfies readonly Intent[];

const catalog = loadWorkspaceCatalog();
const csv = readFileSync(`${DATASET_DIR}${DATASET}.csv`, 'utf8');
const recordedProfile: DataProfile = JSON.parse(
  readFileSync(`${DATASET_DIR}${DATASET}.json`, 'utf8'),
);
const profile = profileColumns(parseCsvTable(csv), HOST);

/** Every intent sees the same profile and the same catalog — only the objective moves. */
function run(intent: Intent): EngineDecision {
  return decide({ intent, profile, catalog });
}

function ids(entries: readonly { id: string }[]): string[] {
  return entries.map((entry) => entry.id);
}

function scoreOf(decision: EngineDecision, id: string): number | undefined {
  return decision.eligible.find((entry) => entry.id === id)?.score;
}

function reasonFor(decision: EngineDecision, id: string): string | undefined {
  return decision.rejected.find((entry) => entry.id === id)?.reason;
}

/** The catalog's own actions, minus anything outside the closed spec set. */
function catalogActions(id: string): string[] {
  const entry = catalog.find((item) => item.id === id);
  return [...(entry?.allowedActions ?? [])].filter((action) => SPEC_ACTION_SET.has(action));
}

describe('eval dataset', () => {
  it('matches its recorded DataProfile, key for key', () => {
    expect(profile).toEqual(recordedProfile);
    expect(Object.keys(recordedProfile)).toEqual([...DATA_PROFILE_KEYS]);
  });

  it('proves geo, category+metric, rows and an entity id from one table', () => {
    expect(profile.hasGeo).toBe(true);
    expect(profile.hasCategory).toBe(true);
    expect(profile.hasNumericMetric).toBe(true);
    expect(profile.categoryCardinality).toBe(5);
    expect(profile.hasTabularRows).toBe(true);
    expect(profile.rowCount).toBe(10);
    expect(profile.hasEntityId).toBe(true);
  });

  it('carries no form controls, so `form` must be won on the data', () => {
    expect(profile.controlCount).toBe(0);
    expect(profile.allControlsLabelled).toBe(false);
  });

  it('takes the map token from the host, never from a column', () => {
    expect(profileColumns(parseCsvTable(csv)).hasMapToken).toBe(false);
    expect(profile.hasMapToken).toBe(true);
  });
});

describe('same dataset × four intents', () => {
  it('spatial picks the map, because the host has a token', () => {
    const decision = run('spatial');

    expect(decision.winner).toBe('map-chart');
    expect(ids(decision.eligible)).toEqual(['map-chart']);
    expect(decision.trace.objective).toBe('spatial');

    // pan / zoom are catalog actions; the workspace never sees them.
    expect(decision.trace.actions).toEqual(['hover', 'resize']);
    expect(decision.trace.actions).toEqual(catalogActions('map-chart'));

    // The comparison winner loses this intent on a sentence, not on a code.
    expect(reasonFor(decision, 'bar-chart')).toBe(
      'Component intents do not include this objective.',
    );
  });

  it('comparison picks bars over the histogram on the same numbers', () => {
    const decision = run('comparison');

    expect(decision.winner).toBe('bar-chart');
    // Contested: the histogram is eligible too, and is outscored, not excluded.
    expect(ids(decision.eligible)).toEqual(['bar-chart', 'histogram-chart']);
    expect(scoreOf(decision, 'bar-chart')).toBeGreaterThan(scoreOf(decision, 'histogram-chart')!);
    expect(decision.trace.actions).toEqual(['hover', 'resize']);
  });

  it('summary picks the KPI over the table on a documented tie-break', () => {
    const decision = run('summary');

    expect(decision.winner).toBe('kpi-widget');
    expect(ids(decision.eligible)).toEqual(['kpi-widget', 'table']);
    // Same score: the trace has to say out loud why one of them won.
    expect(scoreOf(decision, 'kpi-widget')).toBe(scoreOf(decision, 'table'));
    expect(decision.trace.tieBreak).toContain('kpi-widget');
    expect(decision.trace.tieBreak).toContain('table');
    expect(decision.trace.actions).toEqual(['resize']);
  });

  it('form picks approval over the controls this dataset cannot fill', () => {
    const decision = run('form');

    expect(decision.winner).toBe('approval-bar');
    expect(ids(decision.eligible)).toEqual(['approval-bar']);
    expect(decision.trace.actions).toEqual(['approve', 'reject']);

    // Every labelled-control component is refused, each with its own sentence.
    const controls = [
      'form',
      'text-input',
      'number-input',
      'select',
      'multi-select',
      'checkbox',
      'date-input',
      'button',
    ];
    for (const id of controls) {
      expect(reasonFor(decision, id), id).toBe('Unlabelled control is refused.');
    }
  });
});

describe('four intents, four workspaces', () => {
  const decisions = OBJECTIVES.map((intent) => [intent, run(intent)] as const);

  it('never returns the same component twice', () => {
    const winners = decisions.map(([, decision]) => decision.winner);
    expect(winners).toEqual(['map-chart', 'bar-chart', 'kpi-widget', 'approval-bar']);
    expect(new Set(winners).size).toBe(OBJECTIVES.length);
  });

  it('is not four bar-charts wearing different labels', () => {
    for (const [intent, decision] of decisions) {
      if (intent === 'comparison') continue;
      expect(decision.winner, intent).not.toBe('bar-chart');
    }
  });

  it('answers every intent — no objective falls through', () => {
    for (const [intent, decision] of decisions) {
      expect(decision.winner, intent).not.toBeNull();
      expect(decision.eligible.length, intent).toBeGreaterThan(0);
    }
  });

  it('declares only closed actions, and only ones the catalog allows', () => {
    for (const [intent, decision] of decisions) {
      expect(decision.trace.actions, intent).toEqual(catalogActions(decision.winner!));
      for (const action of decision.trace.actions) {
        expect(SPEC_ACTION_SET.has(action), `${intent}: ${action}`).toBe(true);
      }
    }
  });

  it('rejects the rest with sentences a reader can act on', () => {
    for (const [intent, decision] of decisions) {
      expect(decision.rejected.length, intent).toBeGreaterThan(0);
      for (const rejection of decision.rejected) {
        expect(rejection.reason, `${intent}: ${rejection.id}`).toMatch(/^\S.* .*\S$/);
        expect(rejection.reason.length, `${intent}: ${rejection.id}`).toBeGreaterThan(8);
      }
    }
  });

  it('accounts for all 20 engine entries on every intent', () => {
    for (const [intent, decision] of decisions) {
      const seen = [...ids(decision.eligible), ...ids(decision.rejected)].sort();
      expect(seen, intent).toEqual(catalog.map((entry) => entry.id).sort());
    }
  });
});

describe('trace snapshots', () => {
  it.each(OBJECTIVES)('records the %s trace, rows excluded', async (intent) => {
    const { trace } = run(intent);

    expect(trace.objective).toBe(intent);
    expect(trace.profile).toEqual(recordedProfile);
    expect(() => assertTraceHasNoRows(trace)).not.toThrow();
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);

    await expect(`${JSON.stringify(trace, null, 2)}\n`).toMatchFileSnapshot(
      `./__snapshots__/${intent}.trace.json`,
    );
  });
});
