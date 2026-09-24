import { describe, expect, it } from 'vitest';

import { createServer } from '../server/create-server.js';
import { containsRowArrays, FROZEN_META_KEYS, META_RESOURCE_URI } from './meta-contract.js';

const appResource = {
  uri: META_RESOURCE_URI,
  name: 'UI9000 Chart',
  mimeType: 'text/html;profile=mcp-app',
  loadHtml: () => '<html></html>',
  ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } },
};

describe('meta contract', () => {
  it('keeps the frozen keys and leaves ui.resourceUri unchanged', async () => {
    const server = createServer(
      () => ({
        ok: true,
        spec: { component: 'map-chart', dataUrl: 'https://workspace.local/v1/data-links/map' },
        summary: 'map-chart for spatial',
        chartType: 'mapChart',
        data: [{ label: 'kept' }],
        trace: {
          objective: 'spatial',
          profile: { hasGeo: true, rowCount: 10, rows: [{ region: 'secret' }], data: [{ secret: 1 }] },
          actions: ['hover'],
          outcome: 'rendered',
        },
      }),
      { appResource },
    );

    const response = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'show_workspace', arguments: { intent: 'spatial' } },
    });
    const result = (response as { result: Record<string, unknown> }).result;
    const meta = result._meta as Record<string, unknown>;
    const ui = meta.ui as { resourceUri: string };

    expect(FROZEN_META_KEYS).toEqual(['_meta.trace', '_meta.proposal', 'ui.resourceUri']);
    expect(ui.resourceUri).toBe(META_RESOURCE_URI);
    expect(meta['ui/resourceUri']).toBe(META_RESOURCE_URI);
    expect(Object.keys(meta).sort()).toEqual(
      ['chartId', 'chartType', 'dataUrl', 'trace', 'ui', 'ui/resourceUri'].sort(),
    );
    expect(meta.proposal).toBeUndefined();
    const structured = result.structuredContent as { data?: unknown; trace?: { profile?: Record<string, unknown> } };
    expect(structured.data).toEqual([{ label: 'kept' }]);
    expect(structured.trace?.profile?.rows).toBeUndefined();
    expect(structured.trace?.profile?.data).toBeUndefined();
    expect(containsRowArrays(meta.trace)).toBe(false);
    expect((meta.trace as { profile: Record<string, unknown> }).profile.rows).toBeUndefined();
  });
});
