#!/usr/bin/env node
/**
 * `ui9000-workspace-server` — stdio by default; `--http` (or MCP_HTTP=1) for
 * Claude.ai / ChatGPT connectors.
 */
import { startWorkspaceHttpServer } from './server/http-workspace.js';
import { startWorkspaceServer } from './workspace-server.js';

const http =
  process.argv.includes('--http') ||
  process.env.MCP_HTTP === '1' ||
  process.env.MCP_HTTP === 'true';

void (async () => {
  if (http) {
    const server = await startWorkspaceHttpServer();
    process.stderr.write(
      `UI9000-Workspace MCP HTTP ${server.url}${server.path} (Claude connector URL path /mcp)\n`,
    );
    return;
  }
  await startWorkspaceServer();
})().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
