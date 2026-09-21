import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseCsvTable, tableRowCount } from '../profiler/table.js';
import {
  isSensitiveDatasetFileName,
  resolveWorkspaceIngest,
  tableFromRecords,
} from './ingest-table.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe('resolveWorkspaceIngest', () => {
  it('skips when no source is set', async () => {
    expect(await resolveWorkspaceIngest({ intent: 'comparison' })).toEqual({
      ok: true,
      skip: true,
    });
  });

  it('parses pasted csv', async () => {
    const result = await resolveWorkspaceIngest({
      csv: 'name,value\na,1\nb,2\n',
    });
    expect(result.ok).toBe(true);
    if (!result.ok || 'skip' in result) return;
    expect(result.table.columns.map((column) => column.name)).toEqual(['name', 'value']);
    expect(tableRowCount(result.table)).toBe(2);
    expect(result.label).toBe('pasted-csv');
  });

  it('reads an absolute csv path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui9000-ingest-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'sales.csv');
    fs.writeFileSync(file, 'dept,n\nA,1\nB,2\n');
    const result = await resolveWorkspaceIngest({ path: file });
    expect(result.ok).toBe(true);
    if (!result.ok || 'skip' in result) return;
    expect(result.label).toBe('sales.csv');
    expect(tableRowCount(result.table)).toBe(2);
  });

  it('rejects url/path when remote sources are disabled', async () => {
    const url = await resolveWorkspaceIngest(
      { url: 'https://example.com/a.csv' },
      { allowRemoteSources: false },
    );
    expect(url).toMatchObject({ ok: false, code: 'invalid_ingest' });
    const file = await resolveWorkspaceIngest(
      { path: '/tmp/a.csv' },
      { allowRemoteSources: false },
    );
    expect(file).toMatchObject({ ok: false, code: 'invalid_ingest' });
  });

  it('rejects two sources at once', async () => {
    const result = await resolveWorkspaceIngest({
      csv: 'a,b\n1,2\n',
      path: '/tmp/x.csv',
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_ingest' });
  });

  it('loads datasetId through loadDataset', async () => {
    const table = parseCsvTable('x,y\n1,2\n');
    const result = await resolveWorkspaceIngest(
      { datasetId: 'abc' },
      {
        loadDataset: (id) =>
          id === 'abc'
            ? {
                columns: table.columns.map((column) => column.name),
                rows: [{ x: '1', y: '2' }],
              }
            : undefined,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok || 'skip' in result) return;
    expect(result.datasetId).toBe('abc');
    expect(tableRowCount(result.table)).toBe(1);
  });
});

describe('ingest helpers', () => {
  it('flags hidden and env files', () => {
    expect(isSensitiveDatasetFileName('/tmp/.env')).toBe(true);
    expect(isSensitiveDatasetFileName('/tmp/env.prod')).toBe(true);
    expect(isSensitiveDatasetFileName('/tmp/sales.csv')).toBe(false);
  });

  it('builds a table from record objects', () => {
    const table = tableFromRecords([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
    expect(table.columns.map((column) => column.name)).toEqual(['a', 'b']);
    expect(table.columns[0]?.values).toEqual(['1', '2']);
  });
});
