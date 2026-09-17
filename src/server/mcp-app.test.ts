import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import {
  formatWorkspaceAppText,
  loadLocalChartAppHtml,
  localChartAppHtmlPath,
  UI9000_META_PREFIX,
} from './mcp-app.js';

describe('workspace MCP App HTML', () => {
  it('finds the sibling mcp-ui chart-app.html in this checkout', () => {
    const path = localChartAppHtmlPath();
    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);
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
