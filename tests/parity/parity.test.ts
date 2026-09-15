import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DATASET,
  ENGINE_WINNERS,
  QUESTIONS,
  TABLE_COLUMNS,
  buildParityRows,
  dataAccuracy,
  engineWinnersPath,
  formatParityCsv,
  formatParityMd,
  loadDatasetRows,
  loadMcpUiFixtures,
  parseParityCsv,
  parityTableCsvPath,
  parityTableMdPath,
} from './harness.js';

const INTENTS = ['spatial', 'comparison', 'summary', 'form'] as const;

describe('parity questions (S3-19)', () => {
  it('has at least eight questions: two of each intent', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(8);
    for (const intent of INTENTS) {
      expect(
        QUESTIONS.filter((item) => item.intent === intent),
        intent,
      ).toHaveLength(2);
    }
  });

  it('uses the S3-08 regional-incidents dataset', () => {
    expect(DATASET).toBe('regional-incidents');
    const rows = loadDatasetRows();
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({
      id: 'INC-001',
      country: 'FR',
      team: 'Platform',
      incidents: '12',
    });
  });
});

describe('mcp-ui fill script / known fixtures', () => {
  it('covers every question with a tool and chart id', () => {
    const fixtures = loadMcpUiFixtures();
    for (const item of QUESTIONS) {
      const fixture = fixtures[item.id];
      expect(fixture, item.id).toBeDefined();
      expect(fixture.tool.length, item.id).toBeGreaterThan(0);
      expect(fixture.chartId.length, item.id).toBeGreaterThan(0);
    }
  });

  it('records generate_* tools and UUID chart ids for spatial, comparison, and summary', () => {
    const fixtures = loadMcpUiFixtures();
    expect(fixtures['spatial-1'].tool).toBe('generate_geo_map_chart');
    expect(fixtures['spatial-2'].tool).toBe('generate_geo_map_chart');
    expect(fixtures['comparison-1'].tool).toBe('generate_simple_single_series_chart');
    expect(fixtures['comparison-2'].tool).toBe('generate_simple_single_series_chart');
    expect(fixtures['summary-1'].tool).toBe('generate_kpi_widget');
    expect(fixtures['summary-2'].tool).toBe('generate_kpi_widget');
    const dataLinkId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const id of [
      'spatial-1',
      'spatial-2',
      'comparison-1',
      'comparison-2',
      'summary-1',
      'summary-2',
    ] as const) {
      expect(fixtures[id].chartId, id).toMatch(dataLinkId);
      expect(fixtures[id].chartId, id).not.toMatch(/^(mapChart|barChart|kpiWidget)$/);
    }
  });

  it('records n/a for form — mcp-ui has no approval generator', () => {
    const fixtures = loadMcpUiFixtures();
    expect(fixtures['form-1'].tool).toBe('n/a');
    expect(fixtures['form-2'].tool).toBe('n/a');
    expect(fixtures['form-1'].data).toBeNull();
    expect(fixtures['form-2'].data).toBeNull();
  });
});

describe('data_accuracy (count + sample, not a chart appearing)', () => {
  it('passes when widget rows equal the dataset, including INC-001', () => {
    const dataset = loadDatasetRows();
    expect(dataAccuracy(dataset, dataset)).toBe('pass');
    expect(dataAccuracy(loadMcpUiFixtures()['spatial-1'].data, dataset)).toBe('pass');
  });

  it('fails when the count drifts or the sample value is missing', () => {
    const dataset = loadDatasetRows();
    expect(dataAccuracy(dataset.slice(0, 3), dataset)).toBe('fail');
    expect(dataAccuracy([{ id: 'OTHER', country: 'XX', team: 'X', incidents: '0' }], dataset)).toBe(
      'fail',
    );
  });

  it('is n/a when mcp-ui has no widget payload (form)', () => {
    expect(dataAccuracy(null, loadDatasetRows())).toBe('n/a');
  });
});

describe('parity table', () => {
  const rows = buildParityRows();
  const committed = parseParityCsv(readFileSync(parityTableCsvPath(), 'utf8'));

  it('has the required columns and no scoring column', () => {
    const header = readFileSync(parityTableCsvPath(), 'utf8').split('\n')[0];
    expect(header.split(',')).toEqual([...TABLE_COLUMNS]);
    expect(header).not.toMatch(/score|grade|pass_rate/i);
  });

  it('is completeable: eight rows, mcp_ui filled, engine ids recorded', () => {
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.mcp_ui_tool, row.question).not.toBe('pending');
      expect(row.mcp_ui_chart_id, row.question).not.toBe('pending');
      expect(row.engine_component_id, row.question).not.toBe('pending');
      expect(['pass', 'fail', 'n/a', 'pending']).toContain(row.data_accuracy);
    }
  });

  it('records the S3-08 winners from the shared dataset file, without calling decide() here', () => {
    expect(engineWinnersPath()).toMatch(/fixtures\/datasets\/regional-incidents\.winners\.json$/);
    const byIntent = QUESTIONS.map((item, index) => [item.intent, rows[index]] as const);
    for (const [intent, row] of byIntent) {
      expect(row.engine_component_id).toBe(ENGINE_WINNERS[intent]);
    }
    expect(new Set(INTENTS.map((intent) => ENGINE_WINNERS[intent])).size).toBe(4);
  });

  it('matches the committed CSV and markdown (fill-mcp-ui output)', () => {
    expect(committed).toEqual(rows);
    expect(readFileSync(parityTableCsvPath(), 'utf8')).toBe(formatParityCsv(rows));
    expect(readFileSync(parityTableMdPath(), 'utf8')).toBe(formatParityMd(rows));
  });

  it('does not import the decision engine or compute a pass rate', () => {
    const source = readFileSync(new URL('./harness.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"][^'"]*engine\//);
    expect(source).not.toMatch(/pass_rate|accuracy_score|parity_score/);
  });
});
