/**
 * S3-21 / FUS-4106 — same dataset, four intents, four workspaces, traces on disk.
 *
 * Usage (from packages/core): yarn tsx scripts/s3-21-demo.ts
 * (catalog import needs vitest alias; `yarn test tests/scripts/s3-21-demo.test.ts`
 * is the lock. This file is the generator.)
 *
 * Does not call mcp-ui generate_*. Does not edit src/migrate.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadWorkspaceCatalog } from '../src/catalog/load-workspace.js';
import { decide } from '../src/engine/decide.js';
import { profileColumns } from '../src/profiler/profile-columns.js';
import { parseCsvTable } from '../src/profiler/table.js';
import type { Intent } from '../src/spec/intent.js';
import { assertTraceHasNoRows, type Trace } from '../src/trace/trace.js';
import { handleShowWorkspace } from '../src/tool/show-workspace.js';
import { listWorkspaceTools } from './measure-tools-list-tokens.js';

export const OBJECTIVES = [
  'spatial',
  'comparison',
  'summary',
  'form',
] as const satisfies readonly Intent[];

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = resolve(here, '..');

export function demoDir(): string {
  return join(here, 's3-21-demo');
}

export function datasetCsvPath(): string {
  return join(coreRoot, 'tests/fixtures/datasets/regional-incidents.csv');
}

export function winnersPath(): string {
  return join(coreRoot, 'tests/fixtures/datasets/regional-incidents.winners.json');
}

export type DemoWorkspace = {
  intent: Intent;
  winner: string | null;
  chartType?: string;
  summary?: string;
  specComponent?: string;
  actions: string[];
  tieBreak: string;
  traceFile: string;
};

export type S321DemoReport = {
  dataset: 'regional-incidents';
  tools_list: string[];
  generate_star_in_tools_list: boolean;
  renderer: string;
  workspaces: DemoWorkspace[];
  traces: Record<(typeof OBJECTIVES)[number], Trace>;
};

export async function runS321Demo(): Promise<S321DemoReport> {
  const catalog = loadWorkspaceCatalog();
  const csv = readFileSync(datasetCsvPath(), 'utf8');
  const table = parseCsvTable(csv);
  const profile = profileColumns(table, { hasMapToken: true });
  const listed = await listWorkspaceTools();
  const tools_list = listed.tools.map((tool) => (tool as { name: string }).name);
  const traces = {} as Record<(typeof OBJECTIVES)[number], Trace>;
  const workspaces: DemoWorkspace[] = [];

  for (const intent of OBJECTIVES) {
    const decision = decide({ intent, profile, catalog });
    assertTraceHasNoRows(decision.trace);
    traces[intent] = decision.trace;

    const shown = await handleShowWorkspace(
      { intent, csv },
      {
        catalog,
        profile,
        signDataLink: () => ({
          dataUrl: `https://workspace.local/v1/data-links/${intent}?sig=s321&exp=1`,
        }),
      },
    );
    if (!shown.ok) {
      throw new Error(`show_workspace ${intent} failed: ${shown.code} ${shown.reason}`);
    }

    workspaces.push({
      intent,
      winner: decision.winner,
      chartType: shown.chartType,
      summary: shown.summary,
      specComponent: shown.spec.component,
      actions: decision.trace.actions,
      tieBreak: decision.trace.tieBreak,
      traceFile: `${intent}.trace.json`,
    });
  }

  return {
    dataset: 'regional-incidents',
    tools_list,
    generate_star_in_tools_list: tools_list.some((name) => name.startsWith('generate_')),
    renderer:
      'Hosted MCP App is ui://ui9000/chart (chart-app). interpretWorkspace is the fail-closed unit path, not the live iframe.',
    workspaces,
    traces,
  };
}

export function writeS321Demo(report: S321DemoReport): string {
  const dir = demoDir();
  mkdirSync(dir, { recursive: true });
  for (const intent of OBJECTIVES) {
    writeFileSync(
      join(dir, `${intent}.trace.json`),
      `${JSON.stringify(report.traces[intent], null, 2)}\n`,
    );
  }
  const { traces: _traces, ...index } = report;
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return dir;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = await runS321Demo();
  const dir = writeS321Demo(report);
  process.stdout.write(`${JSON.stringify({ dir, index: report.workspaces }, null, 2)}\n`);
}
