import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  attachDataHandle,
  readViaHandle,
  type ReadDataLink,
  type SignDataLink,
} from '../../tool/data-channel.js';
import type { WorkspaceSpec } from '../../spec/workspace-spec.js';
import { readDataLink, signDataLink } from './data-link.js';
import { TtlStore } from './store.js';

const TEST_ENV: NodeJS.ProcessEnv = {
  MCP_DATA_LINK_SECRET: 'test-only-secret-value-32-chars-min',
  MCP_BASE_URL: 'https://workspace.local',
};

const spec = { action: 'show_workspace', widgetId: 'bar-chart' } as unknown as WorkspaceSpec;
const rows = [{ region: 'north', value: 99 }];

describe('data-channel contract', () => {
  it('signs and reads through attachDataHandle without leaking rows onto the spec', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui9000-datalink-contract-'));
    const store = new TtlStore(undefined, dir);
    try {
      // The bound forms are what a host injects — they must satisfy the contract types.
      const sign: SignDataLink = (payload) => signDataLink(payload, { env: TEST_ENV, store });
      const read: ReadDataLink = (link) => readDataLink(link, { env: TEST_ENV, store });

      const attached = await attachDataHandle(spec, rows, sign);
      expect(attached.ok).toBe(true);
      if (!attached.ok) return;

      expect(JSON.stringify(attached.spec)).not.toContain('north');
      expect(attached.spec.callServerTool).toBe('read_workspace_data');
      expect(await readViaHandle(attached.spec, read)).toEqual(rows);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
