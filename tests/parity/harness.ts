/**
 * S3-19 / FUS-4089 parity harness — same questions, two paths, no scoring.
 *
 * This folder records choice + data accuracy. It does not import the
 * decision engine, does not grade mcp-ui vs the engine, and does not
 * change engine source. Engine component ids are the S3-08 recorded
 * winners for this dataset.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsvTable, tableRowCount } from '../../src/profiler/table.js';

export const DATASET = 'regional-incidents';

const here = dirname(fileURLToPath(import.meta.url));

export const TABLE_COLUMNS = [
  'question',
  'mcp_ui_tool',
  'mcp_ui_chart_id',
  'engine_component_id',
  'data_accuracy',
  'notes',
] as const;

export type Intent = 'spatial' | 'comparison' | 'summary' | 'form';
export type AccuracyVerdict = 'pass' | 'fail' | 'n/a' | 'pending';

export type ParityQuestion = {
  id: string;
  intent: Intent;
  question: string;
};

export type McpUiFixture = {
  tool: string;
  chartId: string;
  data: Record<string, string>[] | null;
};

export type ParityRow = {
  question: string;
  mcp_ui_tool: string;
  mcp_ui_chart_id: string;
  engine_component_id: string;
  data_accuracy: AccuracyVerdict;
  notes: string;
};

/** Recorded S3-08 winners — shared with tests/eval, not computed here. */
export function engineWinnersPath(): string {
  return join(here, '../fixtures/datasets', `${DATASET}.winners.json`);
}

export const ENGINE_WINNERS: Record<Intent, string> = JSON.parse(
  readFileSync(engineWinnersPath(), 'utf8'),
) as Record<Intent, string>;

export const QUESTIONS: readonly ParityQuestion[] = [
  {
    id: 'spatial-1',
    intent: 'spatial',
    question: 'Show incidents on a map by country.',
  },
  {
    id: 'spatial-2',
    intent: 'spatial',
    question: 'Where are these incidents geographically?',
  },
  {
    id: 'comparison-1',
    intent: 'comparison',
    question: 'Compare incident counts by team as a bar chart.',
  },
  {
    id: 'comparison-2',
    intent: 'comparison',
    question: 'Which teams have more incidents than the others?',
  },
  {
    id: 'summary-1',
    intent: 'summary',
    question: 'Give me a KPI of total incidents.',
  },
  {
    id: 'summary-2',
    intent: 'summary',
    question: 'Summarize the incident count for this dataset.',
  },
  {
    id: 'form-1',
    intent: 'form',
    question: 'Approve or reject incident INC-001.',
  },
  {
    id: 'form-2',
    intent: 'form',
    question: 'I need to accept or reject these incident records.',
  },
];

export function datasetCsvPath(): string {
  return join(here, '../fixtures/datasets', `${DATASET}.csv`);
}

export function mcpUiFixturePath(): string {
  return join(here, 'fixtures/mcp-ui-responses.json');
}

export function parityTableCsvPath(): string {
  return join(here, 'parity-table.csv');
}

export function parityTableMdPath(): string {
  return join(here, 'parity-table.md');
}

export function loadDatasetRows(): Record<string, string>[] {
  const table = parseCsvTable(readFileSync(datasetCsvPath(), 'utf8'));
  const count = tableRowCount(table);
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < count; i += 1) {
    const row: Record<string, string> = {};
    for (const column of table.columns) {
      row[column.name] = column.values[i] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

export function loadMcpUiFixtures(): Record<string, McpUiFixture> {
  return JSON.parse(readFileSync(mcpUiFixturePath(), 'utf8')) as Record<string, McpUiFixture>;
}

/**
 * Widget rows match the dataset when the count is equal and a value sample
 * from the first dataset row appears in the widget payload. Not a score.
 */
export function dataAccuracy(
  widgetRows: Record<string, string>[] | null,
  datasetRows: Record<string, string>[],
): AccuracyVerdict {
  if (widgetRows == null) return 'n/a';
  if (widgetRows.length !== datasetRows.length) return 'fail';
  const sample = datasetRows[0];
  if (!sample) return 'fail';
  const hit = widgetRows.some((row) =>
    Object.entries(sample).every(([key, value]) => row[key] === value),
  );
  return hit ? 'pass' : 'fail';
}

export function buildParityRows(
  fixtures: Record<string, McpUiFixture> = loadMcpUiFixtures(),
  datasetRows: Record<string, string>[] = loadDatasetRows(),
): ParityRow[] {
  return QUESTIONS.map((item) => {
    const fixture = fixtures[item.id];
    if (!fixture) {
      throw new Error(`Missing mcp-ui fixture for ${item.id}`);
    }
    const accuracy = dataAccuracy(fixture.data, datasetRows);
    const notes = [
      `intent=${item.intent}`,
      `dataset=${DATASET}`,
      item.intent === 'form'
        ? 'mcp-ui has no approval/form generator; engine path is approval-bar'
        : 'mcp_ui_chart_id is a fixture data-link UUID; live mcp-ui mints a new id per sign',
    ].join('; ');
    return {
      question: item.question,
      mcp_ui_tool: fixture.tool,
      mcp_ui_chart_id: fixture.chartId,
      engine_component_id: ENGINE_WINNERS[item.intent],
      data_accuracy: accuracy,
      notes,
    };
  });
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function formatParityCsv(rows: readonly ParityRow[]): string {
  const header = TABLE_COLUMNS.join(',');
  const body = rows.map((row) => TABLE_COLUMNS.map((column) => csvCell(row[column])).join(','));
  return `${[header, ...body].join('\n')}\n`;
}

export function formatParityMd(rows: readonly ParityRow[]): string {
  const header = `| ${TABLE_COLUMNS.join(' | ')} |`;
  const rule = `| ${TABLE_COLUMNS.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${TABLE_COLUMNS.map((column) => row[column]).join(' | ')} |`);
  return `${[header, rule, ...body].join('\n')}\n`;
}

export function parseParityCsv(text: string): ParityRow[] {
  const table = parseCsvTable(text);
  const index = (name: string) => table.columns.findIndex((column) => column.name === name);
  const positions = TABLE_COLUMNS.map((name) => index(name));
  if (positions.some((position) => position < 0)) {
    throw new Error(`parity-table.csv must have columns ${TABLE_COLUMNS.join(', ')}`);
  }
  const count = tableRowCount(table);
  const rows: ParityRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const cells = positions.map((position) => table.columns[position].values[i] ?? '');
    rows.push({
      question: cells[0],
      mcp_ui_tool: cells[1],
      mcp_ui_chart_id: cells[2],
      engine_component_id: cells[3],
      data_accuracy: cells[4] as AccuracyVerdict,
      notes: cells[5],
    });
  }
  return rows;
}

/** Fill `mcp_ui_*` from the known-response fixture and write the table. */
export function writeParityTable(): { csv: string; md: string; rows: ParityRow[] } {
  const rows = buildParityRows();
  const csv = formatParityCsv(rows);
  const md = formatParityMd(rows);
  writeFileSync(parityTableCsvPath(), csv);
  writeFileSync(parityTableMdPath(), md);
  return { csv, md, rows };
}
