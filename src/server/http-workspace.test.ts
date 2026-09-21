import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { SHOW_WORKSPACE_NAME } from '../tool/show-workspace.js';
import { startWorkspaceHttpServer } from './http-workspace.js';

const HTML = '<!doctype html><html><body>ui9000-chart</body></html>';

describe('workspace Streamable HTTP', () => {
  it('lists show_workspace and returns a comparison envelope', async () => {
    const http = await startWorkspaceHttpServer({
      host: '127.0.0.1',
      port: 0,
      env: {
        MCP_BASE_URL: 'http://127.0.0.1:8099',
        MCP_DATA_LINK_SECRET: 'workspace-http-it-secret',
      },
      loadChartHtml: () => HTML,
    });

    const client = new Client({ name: 'workspace-http-it', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${http.url}${http.path}`));
    await client.connect(transport);

    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(1);
      expect(tools.tools[0]?.name).toBe(SHOW_WORKSPACE_NAME);

      const read = await client.readResource({ uri: 'ui://ui9000/chart' });
      expect((read.contents[0] as { text?: string }).text).toContain('ui9000-chart');

      const called = await client.callTool({
        name: SHOW_WORKSPACE_NAME,
        arguments: { intent: 'comparison' },
      });
      expect(called.isError).toBeFalsy();
      const text = (called.content as Array<{ type: string; text?: string }>)[0]?.text;
      expect(text).toContain('ui9000-meta:');
      expect(text).toMatch(/bar-chart|comparison/i);
    } finally {
      await client.close();
      await http.close();
    }
  });

  it('answers OPTIONS and /health without MCP framing', async () => {
    const http = await startWorkspaceHttpServer({
      host: '127.0.0.1',
      port: 0,
      env: {
        MCP_BASE_URL: 'http://127.0.0.1:8099',
        MCP_DATA_LINK_SECRET: 'workspace-http-it-secret',
      },
      loadChartHtml: () => HTML,
    });

    try {
      const health = await fetch(`${http.url}/health`);
      expect(health.status).toBe(200);
      expect(await health.text()).toBe('ok');

      const preflight = await fetch(`${http.url}${http.path}`, { method: 'OPTIONS' });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    } finally {
      await http.close();
    }
  });
});
