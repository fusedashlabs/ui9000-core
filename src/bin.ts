#!/usr/bin/env node
/**
 * `ui9000-workspace-server` — stdio MCP with one tool, `show_workspace`.
 * Started by `yarn workspace @ui9000/core start`.
 */
import { startWorkspaceServer } from './workspace-server.js';

startWorkspaceServer();
