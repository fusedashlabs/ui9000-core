/**
 * Production stdio uses the same MCP SDK + ext-apps stack as mcp-ui.
 * Cursor's MCP Apps host is tested against that wire shape (registerAppTool /
 * registerAppResource). The hand-rolled createServer stays for in-process
 * JSON-RPC framing tests. Live stdio and HTTP always connect this SDK server.
 * sdk-workspace.test.ts locks the field descriptions tools/list actually sends.
 */
import type { Readable, Writable } from 'node:stream';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

import { INTENTS } from '../spec/intent.js';
import {
  SHOW_WORKSPACE_DESCRIPTION,
  SHOW_WORKSPACE_NAME,
} from '../tool/show-workspace.js';
import {
  SERVER_INFO,
  WORKSPACE_INSTRUCTIONS,
  workspaceToolResult,
  type ShowWorkspaceHandler,
  type ShowWorkspaceToolInfo,
} from './create-server.js';
import type { Disconnect, StdioStreams } from './stdio.js';

/** Same closed enum as SHOW_WORKSPACE_INPUT_SCHEMA (`additionalProperties: false`). */
const ShowWorkspaceArgsSchema = z
  .object({
    intent: z.enum(INTENTS).describe(
      'Closed objective. One of spatial, comparison, summary, form, evidence, graph. Do not invent values.',
    ),
    csv: z.string().optional().describe(
      'Pasted CSV including the header row. Empty string means omit.',
    ),
    url: z.string().optional().describe(
      'http(s) URL to a CSV. Local/dev only — rejected on hosted/production. Empty string means omit.',
    ),
    path: z.string().optional().describe(
      'Local CSV path. Local/dev only. Empty string means omit.',
    ),
    datasetId: z.string().optional().describe(
      'Id returned by an earlier show_workspace on this table. Use instead of csv/url/path.',
    ),
    utterance: z.string().optional().describe(
      "The user's words, for Jev. Empty string means omit.",
    ),
    requestedChart: z.string().optional().describe(
      'The chart the user asked for. Omit when they did not name a chart.',
    ),
    confirm: z.boolean().optional().describe(
      'Ignored. The next call draws the chart the user picks.',
    ),
    columns: z.array(z.string()).optional().describe(
      'Column names the user asked to chart. Names only, not cell values.',
    ),
  })
  .strict();

export function createSdkWorkspaceServer(
  handler: ShowWorkspaceHandler,
  info: ShowWorkspaceToolInfo,
): McpServer {
  assertIntentSchema(info.inputSchema);
  const appResource = info.appResource;
  if (!appResource) {
    throw new Error('createSdkWorkspaceServer requires an MCP App resource.');
  }

  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {} },
    instructions: WORKSPACE_INSTRUCTIONS,
  });

  registerAppResource(
    server,
    appResource.name,
    appResource.uri,
    {
      description: appResource.description,
      _meta: { ui: appResource.ui },
    },
    async () => {
      const text = await appResource.loadHtml();
      return {
        contents: [
          {
            uri: appResource.uri,
            mimeType: appResource.mimeType,
            text,
            _meta: { ui: appResource.ui },
          },
        ],
      };
    },
  );

  const resourceUri = appResource.uri;
  server.registerTool(
    SHOW_WORKSPACE_NAME,
    {
      title: 'Show workspace',
      description: info.description ?? SHOW_WORKSPACE_DESCRIPTION,
      inputSchema: ShowWorkspaceArgsSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: {
          resourceUri,
          visibility: ['model', 'app'],
          csp: appResource.ui.csp,
        },
        'ui/resourceUri': resourceUri,
      },
    },
    async (args) =>
      workspaceToolResult(await handler(args), appResource) as CallToolResult,
  );

  return server;
}

export async function connectSdkWorkspace(
  handler: ShowWorkspaceHandler,
  info: ShowWorkspaceToolInfo,
  streams?: StdioStreams,
): Promise<Disconnect> {
  const server = createSdkWorkspaceServer(handler, info);
  const transport = new StdioServerTransport(
    streams?.input as Readable | undefined,
    streams?.output as Writable | undefined,
  );
  await server.connect(transport);

  return () => {
    void server.close();
  };
}

function assertIntentSchema(inputSchema: Record<string, unknown> | undefined): void {
  if (!inputSchema) return;
  const listed = inputSchema as {
    additionalProperties?: unknown;
    properties?: { intent?: { enum?: unknown } };
  };
  const fromJson = listed.properties?.intent?.enum;
  if (Array.isArray(fromJson) && fromJson.join() !== INTENTS.join()) {
    throw new Error('show_workspace SDK schema drifted from SHOW_WORKSPACE_INPUT_SCHEMA.');
  }
}
