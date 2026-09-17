/**
 * S3-20 / FUS-4091 — measure `tools/list` tokens, mcp-ui vs workspace-server.
 *
 * Same machine, same tokenizer (js-tiktoken `cl100k_base`). Counts the JSON-RPC
 * `tools/list` result payload (`{ tools: [...] }`), not a prose estimate.
 *
 * Usage (from packages/core): yarn tsx scripts/measure-tools-list-tokens.ts
 *
 * Does not edit engine, gateway, or mcp-ui. mcp-ui is spawned from the sibling
 * checkout when present; otherwise `mcp_ui` is written as pending.
 */

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getEncoding } from 'js-tiktoken';

import { createServer } from '../src/server/index.js';
import { workspaceChartAppResource } from '../src/server/mcp-app.js';
import {
  SHOW_WORKSPACE_DESCRIPTION,
  SHOW_WORKSPACE_INPUT_SCHEMA,
} from '../src/tool/show-workspace.js';

export const TOKENIZER = 'cl100k_base';

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = resolve(here, '..');

export function outputPath(): string {
  return join(here, 'tools-list-tokens.json');
}

export function mcpUiRoot(from: string = coreRoot): string {
  return resolve(from, '../../../mcp-ui');
}

const encoding = getEncoding(TOKENIZER);

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}

export function payloadText(toolsListResult: unknown): string {
  return JSON.stringify(toolsListResult);
}

export type SideMeasure = {
  tokens: number | 'pending';
  utf8_bytes?: number;
  tool_count?: number;
  names?: string[];
  note?: string;
};

export type ToolsListTokenReport = {
  tokenizer: typeof TOKENIZER;
  measured_at: string;
  mcp_ui: number | 'pending';
  workspace: number | 'pending';
  delta_pct: number | 'pending';
  mcp_ui_detail: SideMeasure;
  workspace_detail: SideMeasure;
};

/**
 * `tools/list` metadata only. Does not boot `createWorkspaceServer()` because
 * that loader hits `import.meta.glob` (widgets catalog), which tsx does not
 * provide. Description + schema must stay the same constants
 * `createWorkspaceServer` passes into `createServer`; the vitest locks that.
 */
export async function listWorkspaceTools(): Promise<{ tools: unknown[] }> {
  const server = createServer(
    () => ({ ok: true }),
    {
      description: SHOW_WORKSPACE_DESCRIPTION,
      inputSchema: JSON.parse(JSON.stringify(SHOW_WORKSPACE_INPUT_SCHEMA)) as Record<
        string,
        unknown
      >,
      appResource: workspaceChartAppResource('https://mcp.ui9000.com', () => ''),
    },
  );
  const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  if (!response?.result || typeof response.result !== 'object') {
    throw new Error('workspace-server tools/list returned no result');
  }
  const result = response.result as { tools?: unknown[] };
  if (!Array.isArray(result.tools)) {
    throw new Error('workspace-server tools/list is missing tools[]');
  }
  return { tools: result.tools };
}

type JsonRpcLine = {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: unknown;
};

async function listMcpUiTools(root: string): Promise<{ tools: unknown[] }> {
  const tsx = join(root, 'node_modules/.bin/tsx');
  if (!existsSync(tsx) || !existsSync(join(root, 'src/mcp-stdio.ts'))) {
    throw new Error(`mcp-ui stdio entry not found under ${root}`);
  }

  const child = spawn(tsx, ['src/mcp-stdio.ts'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MCP_UI_READ_ONLY: '',
      MCP_DATA_LINK_SECRET: 'measure-tools-list-secret-32chars-min',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const frames: JsonRpcLine[] = [];
  let buf = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        frames.push(JSON.parse(trimmed) as JsonRpcLine);
      } catch {
        // ignore non-JSON log bleed
      }
    }
  });

  const stderr: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr.push(chunk);
  });

  const send = (message: unknown) => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const listed = await new Promise<JsonRpcLine>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`mcp-ui tools/list timed out. stderr: ${stderr.join('').slice(0, 500)}`));
    }, 20_000);

    const finish = (err?: Error) => {
      const hit = frames.find((frame) => frame.id === 2);
      if (hit) {
        clearTimeout(timer);
        resolvePromise(hit);
        return;
      }
      if (err) {
        clearTimeout(timer);
        reject(err);
      }
    };

    child.stdout.on('data', () => finish());
    child.on('error', (err) => finish(err));
    child.on('exit', (code) => {
      finish(
        frames.some((frame) => frame.id === 2)
          ? undefined
          : new Error(
              `mcp-ui exited ${code} before tools/list. stderr: ${stderr.join('').slice(0, 800)}`,
            ),
      );
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ui9000-core-measure', version: '0.0.0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    child.stdin.end();
  });

  child.kill('SIGTERM');

  if (listed.error) {
    throw new Error(`mcp-ui tools/list error: ${JSON.stringify(listed.error)}`);
  }
  const result = listed.result as { tools?: unknown[] } | undefined;
  if (!Array.isArray(result?.tools)) {
    throw new Error('mcp-ui tools/list is missing tools[]');
  }
  return { tools: result.tools };
}

function measureSide(label: string, result: { tools: unknown[] }): SideMeasure {
  const text = payloadText(result);
  const names = result.tools.map((tool) =>
    tool && typeof tool === 'object' && 'name' in tool ? String((tool as { name: unknown }).name) : '?',
  );
  return {
    tokens: countTokens(text),
    utf8_bytes: Buffer.byteLength(text, 'utf8'),
    tool_count: result.tools.length,
    names,
    note: `${label} tools/list result JSON, tokenizer=${TOKENIZER}`,
  };
}

function deltaPct(mcpUi: number, workspace: number): number {
  if (mcpUi === 0) return 0;
  return Math.round(((workspace - mcpUi) / mcpUi) * 10000) / 100;
}

export async function measureToolsListTokens(): Promise<ToolsListTokenReport> {
  const workspaceResult = await listWorkspaceTools();
  const workspace_detail = measureSide('workspace-server', workspaceResult);

  let mcp_ui_detail: SideMeasure;
  const sibling = mcpUiRoot();
  try {
    const mcpUiResult = await listMcpUiTools(sibling);
    mcp_ui_detail = measureSide('mcp-ui', mcpUiResult);
  } catch (err) {
    mcp_ui_detail = {
      tokens: 'pending',
      note: `mcp-ui tools/list not measured: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const mcp_ui = mcp_ui_detail.tokens;
  const workspace = workspace_detail.tokens;
  const delta_pct =
    typeof mcp_ui === 'number' && typeof workspace === 'number'
      ? deltaPct(mcp_ui, workspace)
      : 'pending';

  return {
    tokenizer: TOKENIZER,
    measured_at: new Date().toISOString(),
    mcp_ui,
    workspace,
    delta_pct,
    mcp_ui_detail,
    workspace_detail,
  };
}

export function writeToolsListTokenReport(report: ToolsListTokenReport): string {
  const path = outputPath();
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const report = await measureToolsListTokens();
  const path = writeToolsListTokenReport(report);
  process.stdout.write(
    `wrote ${path}\n  tokenizer=${report.tokenizer}\n  mcp_ui=${report.mcp_ui}\n  workspace=${report.workspace}\n  delta_pct=${report.delta_pct}\n`,
  );
}
