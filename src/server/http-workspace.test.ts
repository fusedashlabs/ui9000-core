import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { SHOW_WORKSPACE_NAME } from '../tool/show-workspace.js';
import { WORKSPACE_INSTRUCTIONS } from './create-server.js';
import { handleWorkspaceMcpHttpRequest, startWorkspaceHttpServer } from './http-workspace.js';

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
      expect(client.getInstructions()).toBe(WORKSPACE_INSTRUCTIONS);

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
      expect(preflight.headers.get('access-control-allow-origin')).toBeNull();

      const echoed = await fetch(`${http.url}${http.path}`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://127.0.0.1' },
      });
      expect(echoed.status).toBe(204);
      expect(echoed.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1');

      const foreign = await fetch(`${http.url}/health`, {
        headers: { Origin: 'https://evil.example' },
      });
      expect(foreign.status).toBe(403);
    } finally {
      await http.close();
    }
  });

  it('requires the bearer token only when MCP_HTTP_TOKEN is set', async () => {
    const http = await startWorkspaceHttpServer({
      host: '127.0.0.1',
      port: 0,
      env: {
        MCP_BASE_URL: 'http://127.0.0.1:8099',
        MCP_DATA_LINK_SECRET: 'workspace-http-it-secret',
        MCP_HTTP_TOKEN: 'workspace-http-token',
      },
      loadChartHtml: () => HTML,
    });

    try {
      const denied = await fetch(`${http.url}${http.path}`, { method: 'POST' });
      expect(denied.status).toBe(401);

      const wrong = await fetch(`${http.url}${http.path}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer workspace-http-WRONG' },
      });
      expect(wrong.status).toBe(401);

      const health = await fetch(`${http.url}/health`);
      expect(health.status).toBe(200);

      const client = new Client({ name: 'workspace-http-auth', version: '0.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${http.url}${http.path}`), {
        requestInit: { headers: { Authorization: 'bearer workspace-http-token' } },
      });
      await client.connect(transport);
      try {
        const tools = await client.listTools();
        expect(tools.tools[0]?.name).toBe(SHOW_WORKSPACE_NAME);
      } finally {
        await client.close();
      }
    } finally {
      await http.close();
    }
  });

  it('requires the bearer token on the mounted handler mcp-ui calls', async () => {
    const env = {
      MCP_BASE_URL: 'http://127.0.0.1:8099',
      MCP_DATA_LINK_SECRET: 'workspace-http-it-secret',
      MCP_HTTP_TOKEN: 'workspace-http-token',
    };
    const httpServer = createServer((req, res) => {
      void handleWorkspaceMcpHttpRequest(req, res, undefined, {
        env,
        loadChartHtml: () => HTML,
      });
    });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/workspace/mcp`;

    try {
      const denied = await fetch(url, { method: 'POST' });
      expect(denied.status).toBe(401);

      const client = new Client({ name: 'workspace-mounted-auth', version: '0.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: 'Bearer workspace-http-token' } },
      });
      await client.connect(transport);
      try {
        const tools = await client.listTools();
        expect(tools.tools[0]?.name).toBe(SHOW_WORKSPACE_NAME);
      } finally {
        await client.close();
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
