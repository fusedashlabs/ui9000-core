/**
 * CSV through classify → profile → decide → spec → payload.
 * The recorded-profile eval set never crosses these boundaries.
 */
import { describe, expect, it } from 'vitest';

import { loadWorkspaceCatalog } from '../../../src/catalog/load-workspace.js';
import { profileColumns } from '../../../src/profiler/profile-columns.js';
import { classifyColumns } from '../../../src/profiler/roles.js';
import { parseCsvTable } from '../../../src/profiler/table.js';
import { readViaHandle, type SignedLink } from '../../../src/tool/data-channel.js';
import {
  handleShowWorkspace,
  type ShowWorkspaceContext,
  type ShowWorkspaceResult,
} from '../../../src/tool/show-workspace.js';

function isDrawn(result: ShowWorkspaceResult): result is Extract<ShowWorkspaceResult, { ok: true; spec: unknown }> {
  return result.ok === true && result.awaitingUser !== true;
}

function session(csv: string) {
  const table = parseCsvTable(csv);
  const store = new Map<string, unknown>();
  let seq = 0;
  const signDataLink = (payload: unknown): SignedLink => {
    const id = `link-${++seq}`;
    store.set(id, payload);
    return { dataUrl: `https://workspace.local/v1/data-links/${id}` };
  };
  const context: ShowWorkspaceContext = {
    catalog: loadWorkspaceCatalog(),
    profile: profileColumns(table, { hasMapToken: true }),
    payload: table.columns[0]
      ? Array.from({ length: table.columns[0].values.length }, (_unused, row) => {
          const record: Record<string, string> = {};
          for (const column of table.columns) record[column.name] = column.values[row] ?? '';
          return record;
        })
      : [],
    fields: table.columns.map((column) => column.name),
    classified: classifyColumns(table).columns,
    signDataLink,
  };
  return {
    context,
    read: (link: SignedLink) => store.get(link.dataUrl.split('/').pop() ?? ''),
  };
}

describe('show_workspace from csv', () => {
  it('draws a line for a monthly metric, not a histogram', async () => {
    const { context, read } = session('month,revenue\n2024-01,100\n2024-02,120\n2024-03,90\n2024-04,140\n2024-05,160\n2024-06,150\n2024-07,170\n2024-08,180\n');
    const result = await handleShowWorkspace({ intent: 'comparison' }, context);
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('line-chart');
    expect(result.summary).not.toContain('no eligible candidate');
    const payload = await readViaHandle(result.spec, read);
    expect(payload).toMatchObject({ xAxe: ['month'], yAxe: ['revenue'] });
  });

  it('draws a network from source and target, without a node column', async () => {
    const { context, read } = session('source,target,weight\nA,B,2\nB,C,3\n');
    const result = await handleShowWorkspace({ intent: 'graph' }, context);
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('network-graph');
    const payload = await readViaHandle(result.spec, read);
    expect(payload).toMatchObject({
      nodes: expect.arrayContaining([{ id: 'A' }, { id: 'B' }, { id: 'C' }].map((node) => expect.objectContaining(node))),
      links: expect.arrayContaining([
        expect.objectContaining({ source: 'A', target: 'B', value: 2 }),
        expect.objectContaining({ source: 'B', target: 'C', value: 3 }),
      ]),
    });
  });

  it('does not draw a bar when spatial has no geography', async () => {
    const { context } = session('team,incidents\nAlpha,4\nBeta,9\n');
    const result = await handleShowWorkspace({ intent: 'spatial' }, context);
    expect(result.ok && result.awaitingUser).toBe(true);
    if (!result.ok || !result.awaitingUser) return;
    expect(result.message).toContain('spatial');
  });

  it('keeps a metric when one cell is n/a and still builds a map', async () => {
    const { context, read } = session('country,incidents,note\nFR,12,ok\nDE,n/a,ok\nIT,8,ok\n');
    const result = await handleShowWorkspace({ intent: 'spatial' }, context);
    expect(isDrawn(result)).toBe(true);
    if (!isDrawn(result)) return;
    expect(result.spec.component).toBe('map-chart');
    const payload = await readViaHandle(result.spec, read);
    expect(Array.isArray(payload)).toBe(false);
    expect(payload).toMatchObject({ layers: expect.any(Array) });
  });
});
