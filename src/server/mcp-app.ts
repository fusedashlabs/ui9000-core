/**
 * MCP Apps surface for Cursor / Claude — same `ui://ui9000/chart` as mcp-ui.
 * Prefer the sibling checkout's generated App View so local iframe/CSS
 * changes show up without a deploy. Fall back to
 * `https://mcp.ui9000.com/mcp-app/chart` when that file is missing
 * (published bin, other machines).
 * Do not put a bare data-link URL in tool text: hosts open it as a page (JSON).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOSTED_MCP_BASE_URL } from '../migrate/datalink/hosted.js';

export const WORKSPACE_CHART_RESOURCE_URI = 'ui://ui9000/chart';

export const MCP_APP_RESOURCE_MIME = 'text/html;profile=mcp-app';

/** Same prefix mcp-ui chart-app parses from tool text (Cursor often strips `_meta`). */
export const UI9000_META_PREFIX = 'ui9000-meta:';

/** chart-app reads `src/inspector/meta-contract.ts`. It does not invent `_meta` keys. */

export const HOSTED_MCP_APP_CHART_PATH = '/mcp-app/chart';

const MAP_CONNECT_ORIGINS = [
  'https://api.mapbox.com',
  'https://events.mapbox.com',
  'https://a.tiles.mapbox.com',
  'https://b.tiles.mapbox.com',
  'https://dash.fusedash.ai',
  'https://mcp.ui9000.com',
] as const;

const MAP_RESOURCE_ORIGINS = ['https://api.mapbox.com', 'https://*.tiles.mapbox.com'] as const;

export type McpAppCsp = {
  connectDomains: string[];
  resourceDomains: string[];
  frameDomains: string[];
};

export type McpAppResource = {
  uri: string;
  name: string;
  mimeType: string;
  description?: string;
  loadHtml: () => string | Promise<string>;
  ui: { csp: McpAppCsp };
};

export type WorkspaceAppMeta = {
  chartType: string;
  dataUrl: string;
  chartId: string;
  /** Id only. The trace payload stays on `_meta`, never in this prefix. */
  traceId?: string;
};

export function originFromBaseUrl(raw: string, fallback = DEFAULT_HOSTED_MCP_BASE_URL): string {
  const candidate = (raw || fallback).trim() || fallback;
  try {
    return new URL(candidate).origin;
  } catch {
    return new URL(fallback).origin;
  }
}

export function buildWorkspaceChartCsp(baseUrl: string): McpAppCsp {
  const origin = originFromBaseUrl(baseUrl);
  return {
    connectDomains: [...new Set([origin, ...MAP_CONNECT_ORIGINS])],
    resourceDomains: [...MAP_RESOURCE_ORIGINS],
    frameDomains: [],
  };
}

export function hostedChartAppUrl(baseUrl: string): string {
  return `${originFromBaseUrl(baseUrl)}${HOSTED_MCP_APP_CHART_PATH}`;
}

let htmlCache: { url: string; text: string } | undefined;
let localHtmlCache: string | undefined;

export function localChartAppHtmlPath(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const mcpRoot = join(here, '../../../../../');
  const candidates = [
    join(mcpRoot, 'mcp-ui/src/mcp-app/generated/chart-app.html'),
    join(mcpRoot, 'mcp-ui/dist/generated/chart-app.html'),
  ];
  return candidates.find((path) => existsSync(path));
}

export function loadLocalChartAppHtml(): string | undefined {
  if (localHtmlCache) return localHtmlCache;
  const path = localChartAppHtmlPath();
  if (!path) return undefined;
  const text = readFileSync(path, 'utf8');
  if (!text.trim()) return undefined;
  localHtmlCache = text;
  return text;
}

export async function loadChartAppHtml(
  baseUrl: string = DEFAULT_HOSTED_MCP_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const local = loadLocalChartAppHtml();
  if (local) return local;
  return loadHostedChartAppHtml(baseUrl, fetchImpl);
}

export async function loadHostedChartAppHtml(
  baseUrl: string = DEFAULT_HOSTED_MCP_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = hostedChartAppUrl(baseUrl);
  if (htmlCache?.url === url) return htmlCache.text;
  const response = await fetchImpl(url, {
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`MCP App HTML failed (${response.status}) at ${url}`);
  }
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`MCP App HTML was empty at ${url}`);
  }
  htmlCache = { url, text };
  return text;
}

export function resetHostedChartAppHtmlCacheForTests(): void {
  htmlCache = undefined;
  localHtmlCache = undefined;
}

export function chartIdFromDataUrl(dataUrl: string): string {
  try {
    const parts = new URL(dataUrl).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? 'workspace';
  } catch {
    return 'workspace';
  }
}

export function formatWorkspaceAppText(summary: string, meta: WorkspaceAppMeta): string {
  return `${summary}\n${UI9000_META_PREFIX}${JSON.stringify({
    chartType: meta.chartType,
    dataUrl: meta.dataUrl,
    chartId: meta.chartId,
    ...(meta.traceId ? { traceId: meta.traceId } : {}),
  })}`;
}

export function workspaceChartAppResource(
  baseUrl: string,
  loadHtml?: McpAppResource['loadHtml'],
): McpAppResource {
  return {
    uri: WORKSPACE_CHART_RESOURCE_URI,
    name: 'UI9000 Chart',
    mimeType: MCP_APP_RESOURCE_MIME,
    description:
      'Interactive chart surface for show_workspace (hosted mcp-ui App View).',
    loadHtml: loadHtml ?? (() => loadChartAppHtml(baseUrl)),
    ui: { csp: buildWorkspaceChartCsp(baseUrl) },
  };
}
