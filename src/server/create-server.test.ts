import { describe, expect, it, vi } from 'vitest';

import { SHOW_WORKSPACE_NAME } from '../tool/show-workspace.js';
import {
  PROTOCOL_VERSION,
  createServer,
  type JsonRpcResponse,
  type ShowWorkspaceHandler,
} from './create-server.js';

/** Stub handler: the server must not know what show_workspace actually does. */
const stubHandler: ShowWorkspaceHandler = () => ({ ok: true, spec: {}, summary: 'stub' });

/**
 * The 27 tools the incumbent mcp-ui server registers. show_workspace replaces
 * the whole surface, so none of these may reappear here.
 */
const LEGACY_CHART_TOOLS = [
  'generate_area_grouped_bar_chart',
  'generate_bias_variance_tradeoff_chart',
  'generate_boxplot_chart',
  'generate_bubble_chart',
  'generate_custom_chart',
  'generate_donut_chart',
  'generate_geo_map_chart',
  'generate_gini_impurity_entropy_chart',
  'generate_grouped_or_stacked_chart',
  'generate_histogram_chart',
  'generate_kpi_widget',
  'generate_ks_plot_chart',
  'generate_matrix_radar_radial_polar_chart',
  'generate_network_graph',
  'generate_parallel_coordinates_chart',
  'generate_partial_dependence_ice_chart',
  'generate_pie_chart',
  'generate_punchcard_chart',
  'generate_roc_curve_chart',
  'generate_sankey_diagram',
  'generate_scatter_sparkline_chart',
  'generate_scatterplot_chart',
  'generate_simple_single_series_chart',
  'generate_sparkline_chart',
  'generate_treemap_chart',
  'generate_violin_chart',
  'generate_waterfall_chart',
];

function request(method: string, params?: unknown, id: string | number = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

function resultOf(response: JsonRpcResponse | null): Record<string, unknown> {
  expect(response?.error).toBeUndefined();
  return response?.result as Record<string, unknown>;
}

describe('createServer', () => {
  it('lists exactly one tool named show_workspace', async () => {
    const server = createServer(stubHandler, { description: 'stub' });

    const result = resultOf(await server.handle(request('tools/list')));

    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe(SHOW_WORKSPACE_NAME);
    expect(tools[0]?.description).toBe('stub');
  });

  it('lists no generate_* tool', async () => {
    const server = createServer(stubHandler, { description: 'stub' });

    const result = resultOf(await server.handle(request('tools/list')));

    const names = (result.tools as Array<Record<string, unknown>>).map((tool) => String(tool.name));
    expect(names).toEqual([SHOW_WORKSPACE_NAME]);
    expect(names.some((name) => name.startsWith('generate_'))).toBe(false);
    expect(names.filter((name) => LEGACY_CHART_TOOLS.includes(name))).toEqual([]);
  });

  it('refuses every legacy chart tool by name', async () => {
    const handler = vi.fn(stubHandler);
    const server = createServer(handler);

    for (const name of LEGACY_CHART_TOOLS) {
      const response = await server.handle(request('tools/call', { name, arguments: {} }));
      expect(response?.error?.code, name).toBe(-32602);
    }

    expect(handler).not.toHaveBeenCalled();
  });

  it('exposes the same single tool on the server object', () => {
    const server = createServer(stubHandler);

    expect(server.tools.map((tool) => tool.name)).toEqual([SHOW_WORKSPACE_NAME]);
  });

  it('omits the description until one is injected', async () => {
    const server = createServer(stubHandler);

    const result = resultOf(await server.handle(request('tools/list')));

    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools[0]).not.toHaveProperty('description');
    expect(tools[0]?.inputSchema).toEqual({ type: 'object' });
  });

  it('lists the injected input schema', async () => {
    const inputSchema = { type: 'object', required: ['intent'] };
    const server = createServer(stubHandler, { inputSchema });

    const result = resultOf(await server.handle(request('tools/list')));

    expect((result.tools as Array<Record<string, unknown>>)[0]?.inputSchema).toEqual(inputSchema);
  });

  it('advertises tools on initialize', async () => {
    const server = createServer(stubHandler);

    const result = resultOf(await server.handle(request('initialize')));

    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.capabilities).toEqual({ tools: {} });
  });

  it('routes tools/call arguments to the injected handler untouched', async () => {
    const handler = vi.fn(() => ({ ok: true, summary: 'routed' }));
    const server = createServer(handler);

    const result = resultOf(
      await server.handle(
        request('tools/call', { name: 'show_workspace', arguments: { intent: 'comparison' } }),
      ),
    );

    expect(handler).toHaveBeenCalledWith({ intent: 'comparison' });
    expect(result.structuredContent).toEqual({ ok: true, summary: 'routed' });
    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true,"summary":"routed"}' }]);
  });

  it('awaits an async handler', async () => {
    const server = createServer(async () => ({ ok: false, code: 'no_winner' }));

    const result = resultOf(
      await server.handle(request('tools/call', { name: 'show_workspace', arguments: {} })),
    );

    expect(result.structuredContent).toEqual({ ok: false, code: 'no_winner' });
    expect(result.isError).toBeUndefined();
  });

  it('refuses any tool name other than show_workspace', async () => {
    const handler = vi.fn(stubHandler);
    const server = createServer(handler);

    const response = await server.handle(
      request('tools/call', { name: 'generate_chart', arguments: {} }),
    );

    expect(handler).not.toHaveBeenCalled();
    expect(response?.error?.code).toBe(-32602);
    expect(response?.error?.message).toContain('generate_chart');
  });

  it('reports a throwing handler as a tool error, not a transport error', async () => {
    const server = createServer(() => {
      throw new Error('signer failed');
    });

    const result = resultOf(
      await server.handle(request('tools/call', { name: 'show_workspace', arguments: {} })),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'signer failed' }]);
  });

  it('refuses tools/call without a params object', async () => {
    const server = createServer(stubHandler);

    const response = await server.handle(request('tools/call'));

    expect(response?.error?.code).toBe(-32602);
  });

  it('reports an unknown method', async () => {
    const server = createServer(stubHandler);

    const response = await server.handle(request('resources/list'));

    expect(response?.error?.code).toBe(-32601);
  });

  it('stays silent on notifications', async () => {
    const server = createServer(stubHandler);

    await expect(
      server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).resolves.toBeNull();
  });

  it('rejects a non-object message', async () => {
    const server = createServer(stubHandler);

    const response = await server.handle('tools/list');

    expect(response?.error?.code).toBe(-32600);
  });

  it('requires a handler', () => {
    expect(() => createServer(undefined as unknown as ShowWorkspaceHandler)).toThrow(TypeError);
  });
});
