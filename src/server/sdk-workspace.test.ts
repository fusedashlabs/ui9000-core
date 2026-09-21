import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { INTENTS } from '../spec/intent.js';
import { SHOW_WORKSPACE_INPUT_SCHEMA, SHOW_WORKSPACE_NAME } from '../tool/show-workspace.js';
import { createSdkWorkspaceServer } from './sdk-workspace.js';
import { workspaceChartAppResource } from './mcp-app.js';

const HTML = '<!doctype html><html><body>ui9000-chart</body></html>';

describe('createSdkWorkspaceServer', () => {
  it('lists show_workspace, serves the App resource, and envelopes a tool result', async () => {
    const mcp = createSdkWorkspaceServer(
      async () => ({
        ok: true,
        spec: {
          component: 'bar-chart',
          dataUrl: 'https://mcp.ui9000.com/v1/data-links/x?sig=a&exp=1',
        },
        summary: 'bar-chart for comparison',
        chartType: 'barChart',
      }),
      {
        description: 'stub',
        inputSchema: SHOW_WORKSPACE_INPUT_SCHEMA as unknown as Record<string, unknown>,
        appResource: workspaceChartAppResource('https://mcp.ui9000.com', () => HTML),
      },
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'sdk-workspace-test', version: '0.0.0' });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(1);
      expect(tools.tools[0]?.name).toBe(SHOW_WORKSPACE_NAME);
      expect(tools.tools[0]?._meta).toMatchObject({
        ui: { resourceUri: 'ui://ui9000/chart' },
        'ui/resourceUri': 'ui://ui9000/chart',
      });
      expect(tools.tools[0]?.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(
        (tools.tools[0]?.inputSchema as { properties?: { intent?: { enum?: string[] }; csv?: unknown } })
          .properties?.intent?.enum,
      ).toEqual([...INTENTS]);
      expect(
        (tools.tools[0]?.inputSchema as { properties?: { csv?: unknown; datasetId?: unknown } }).properties,
      ).toMatchObject({
        csv: expect.anything(),
        datasetId: expect.anything(),
      });

      const listed = await client.listResources();
      expect(listed.resources).toEqual([
        expect.objectContaining({
          uri: 'ui://ui9000/chart',
          mimeType: 'text/html;profile=mcp-app',
        }),
      ]);

      const read = await client.readResource({ uri: 'ui://ui9000/chart' });
      expect(read.contents).toEqual([
        expect.objectContaining({
          uri: 'ui://ui9000/chart',
          mimeType: 'text/html;profile=mcp-app',
          text: HTML,
        }),
      ]);

      const called = await client.callTool({
        name: SHOW_WORKSPACE_NAME,
        arguments: { intent: 'comparison' },
      });
      expect(called.isError).toBeFalsy();
      const text = (called.content as Array<{ type: string; text?: string }>)[0]?.text;
      expect(text).toContain('ui9000-meta:');
      expect(text).toContain('barChart');
      expect(called._meta).toMatchObject({
        ui: { resourceUri: 'ui://ui9000/chart' },
        chartType: 'barChart',
      });
    } finally {
      await client.close();
      await mcp.close();
    }
  });

  it('rejects extra tool arguments the same way additionalProperties: false does', async () => {
    const mcp = createSdkWorkspaceServer(
      async () => ({ ok: true, spec: {}, summary: 'stub' }),
      {
        appResource: workspaceChartAppResource('https://mcp.ui9000.com', () => HTML),
      },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'sdk-workspace-test', version: '0.0.0' });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const called = await client.callTool({
        name: SHOW_WORKSPACE_NAME,
        arguments: { intent: 'comparison', data: [{ secret: 1 }] },
      });
      expect(called.isError).toBe(true);
    } finally {
      await client.close();
      await mcp.close();
    }
  });
});
