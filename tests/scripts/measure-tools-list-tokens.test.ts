import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  TOKENIZER,
  countTokens,
  listWorkspaceTools,
  outputPath,
} from '../../scripts/measure-tools-list-tokens.js';
import { parseCsvTable } from '../../src/profiler/table.js';
import { createWorkspaceServer } from '../../src/workspace-server.js';

const FIXTURE = fileURLToPath(
  new URL('../fixtures/profiles/category-metric.csv', import.meta.url),
);

describe('measure tools/list tokens (S3-20)', () => {
  it('uses one tokenizer for every payload', () => {
    expect(TOKENIZER).toBe('cl100k_base');
    expect(countTokens('show_workspace')).toBeGreaterThan(0);
    expect(countTokens('show_workspace')).toBe(countTokens('show_workspace'));
  });

  it('lists exactly one workspace tool named show_workspace', async () => {
    const listed = await listWorkspaceTools();
    expect(listed.tools).toHaveLength(1);
    expect((listed.tools[0] as { name: string }).name).toBe('show_workspace');
    const names = listed.tools.map((tool) => (tool as { name: string }).name);
    expect(names).toEqual(['show_workspace']);
    expect(names.some((name) => name.startsWith('generate_'))).toBe(false);
  });

  it('matches createWorkspaceServer tools/list metadata', async () => {
    const listed = await listWorkspaceTools();
    const live = createWorkspaceServer({
      table: parseCsvTable(readFileSync(FIXTURE, 'utf8')),
    });
    const response = await live.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const liveTools = (response?.result as { tools?: unknown[] } | undefined)?.tools;
    expect(liveTools).toEqual(listed.tools);
  });

  it('has a committed lab report with mcp_ui, workspace, delta_pct', () => {
    const report = JSON.parse(readFileSync(outputPath(), 'utf8')) as {
      tokenizer: string;
      mcp_ui: number | 'pending';
      workspace: number | 'pending';
      delta_pct: number | 'pending';
    };
    expect(report.tokenizer).toBe(TOKENIZER);
    expect(report.mcp_ui).toEqual(expect.any(Number));
    expect(report.workspace).toEqual(expect.any(Number));
    expect(report.delta_pct).toEqual(expect.any(Number));
    expect(report.mcp_ui).toBeGreaterThan(report.workspace as number);
    expect(report.workspace).toBeGreaterThan(0);
    expect(report.delta_pct as number).toBeLessThan(0);
  });
});
