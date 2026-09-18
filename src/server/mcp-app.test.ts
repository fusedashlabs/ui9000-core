import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import {
  formatWorkspaceAppText,
  hostedChartAppUrl,
  loadLocalChartAppHtml,
  localChartAppHtmlPath,
  UI9000_META_PREFIX,
} from './mcp-app.js';

describe('workspace MCP App HTML', () => {
  it('prefers sibling mcp-ui chart-app.html, else hosted mcp-app/chart', () => {
    const path = localChartAppHtmlPath();
    if (!path) {
      // GitHub checkout of this repo alone has no sibling mcp-ui. npx uses hosted HTML.
      expect(loadLocalChartAppHtml()).toBeUndefined();
      expect(hostedChartAppUrl('https://mcp.ui9000.com')).toBe(
        'https://mcp.ui9000.com/mcp-app/chart',
      );
      return;
    }
    expect(existsSync(path)).toBe(true);
    const html = loadLocalChartAppHtml();
    expect(html).toContain('ontoolresult');
    expect(html).toContain('UI9000 Chart');
    expect(html).toContain('max(400px, 100vh)');
    expect(html!.length).toBeGreaterThan(100_000);
  });

  it('keeps ui9000-meta durable for hosts that strip _meta', () => {
    const text = formatWorkspaceAppText('bar-chart for comparison', {
      chartType: 'barChart',
      dataUrl: 'https://mcp.ui9000.com/v1/data-links/abc',
      chartId: 'abc',
    });
    expect(text).toContain('bar-chart for comparison');
    expect(text).toContain(`${UI9000_META_PREFIX}{"chartType":"barChart"`);
    expect(text).not.toMatch(/^https:\/\//m);
  });
});
