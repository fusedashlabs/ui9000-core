#!/usr/bin/env node
/**
 * `ui9000-workspace-server` — stdio MCP with one tool, `show_workspace`.
 * Started by `yarn workspace @fusedashlabs/ui9000-workspace start`.
 */
import { startWorkspaceServer } from './workspace-server.js';

void startWorkspaceServer().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
