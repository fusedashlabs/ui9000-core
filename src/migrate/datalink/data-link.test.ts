import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isOpaqueDataUrl } from '../../tool/data-channel.js';
import {
  DEFAULT_MAX_PAYLOAD_SIZE_MB,
  getDataLinkTtlHours,
  getMaxPayloadSizeMb,
  normalizeDataLinkBaseUrl,
  readDataLink,
  signDataLink,
} from './data-link.js';
import { TtlStore } from './store.js';
import { createSignedDataUrl } from './signature.js';

// The secret always comes from the environment; tests supply their own env
// object so no production default is ever baked into the suite.
const TEST_ENV: NodeJS.ProcessEnv = {
  MCP_DATA_LINK_SECRET: 'test-only-secret-value-32-chars-min',
  MCP_BASE_URL: 'https://workspace.local',
};

const rows = [
  { region: 'north', value: 99 },
  { region: 'south', value: 1 },
];

let dir: string;
let store: TtlStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui9000-datalink-'));
  store = new TtlStore(undefined, dir);
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

function sign(payload: unknown, env: NodeJS.ProcessEnv = TEST_ENV) {
  return signDataLink(payload, { env, store });
}

function read(link: { dataUrl: string }, env: NodeJS.ProcessEnv = TEST_ENV) {
  return readDataLink(link, { env, store });
}

describe('signDataLink', () => {
  it('returns an opaque handle the data channel accepts', () => {
    const link = sign(rows);
    expect(isOpaqueDataUrl(link.dataUrl)).toBe(true);
    expect(link.dataUrl.startsWith('https://workspace.local/v1/data-links/')).toBe(true);
  });

  it('never embeds the payload in the url', () => {
    const link = sign(rows);
    const url = new URL(link.dataUrl);
    expect(link.dataUrl).not.toContain('north');
    expect(url.pathname).toMatch(/^\/v1\/data-links\/[0-9a-f-]{36}$/i);
    expect(url.searchParams.has('sig')).toBe(true);
    expect(url.searchParams.has('exp')).toBe(true);
    expect(url.searchParams.get('sig')).not.toContain('north');
  });

  it('issues a distinct id per call', () => {
    expect(sign(rows).dataUrl).not.toBe(sign(rows).dataUrl);
  });

  it('strips a trailing /mcp from the base url', () => {
    const link = signDataLink(rows, {
      env: { ...TEST_ENV, MCP_BASE_URL: 'https://workspace.local/mcp' },
      store,
    });
    expect(link.dataUrl.startsWith('https://workspace.local/v1/data-links/')).toBe(true);
    expect(normalizeDataLinkBaseUrl('https://workspace.local/mcp/')).toBe('https://workspace.local');
  });

  it('does not issue a handle when persist fails', () => {
    const blocked = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocked, 'x');
    const badStore = new TtlStore(undefined, blocked);
    expect(() => signDataLink(rows, { env: TEST_ENV, store: badStore })).toThrow();
  });
});

describe('readDataLink', () => {
  it('round-trips the payload', () => {
    expect(read(sign(rows))).toEqual(rows);
  });

  it('round-trips payloads that are not arrays', () => {
    expect(read(sign({ nested: { a: [1, 2] } }))).toEqual({ nested: { a: [1, 2] } });
  });

  it('returns null for a tampered signature', () => {
    const link = sign(rows);
    const url = new URL(link.dataUrl);
    url.searchParams.set('sig', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(read({ dataUrl: url.toString() })).toBeNull();
  });

  it('returns null when read with a different secret', () => {
    const link = sign(rows);
    expect(read(link, { ...TEST_ENV, MCP_DATA_LINK_SECRET: 'a-different-secret-value-32ch' })).toBeNull();
  });

  it('returns null for an unparseable or empty dataUrl', () => {
    expect(read({ dataUrl: '' })).toBeNull();
    expect(read({ dataUrl: 'not a url' })).toBeNull();
  });

  it('returns null for an unknown id, even with a valid signature', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const dataUrl = createSignedDataUrl(
      'https://workspace.local',
      'never-stored',
      exp,
      TEST_ENV.MCP_DATA_LINK_SECRET as string,
    );
    expect(read({ dataUrl })).toBeNull();
  });
});

describe('TTL', () => {
  it('defaults to 24 hours', () => {
    expect(getDataLinkTtlHours({})).toBe(24);
  });

  it('reads DATA_LINK_TTL_HOURS, flooring the value', () => {
    expect(getDataLinkTtlHours({ DATA_LINK_TTL_HOURS: '3' })).toBe(3);
    expect(getDataLinkTtlHours({ DATA_LINK_TTL_HOURS: '3.9' })).toBe(3);
  });

  it('falls back to 24 for empty, non-numeric, or sub-hour values', () => {
    expect(getDataLinkTtlHours({ DATA_LINK_TTL_HOURS: '' })).toBe(24);
    expect(getDataLinkTtlHours({ DATA_LINK_TTL_HOURS: 'soon' })).toBe(24);
    expect(getDataLinkTtlHours({ DATA_LINK_TTL_HOURS: '0' })).toBe(24);
    expect(getDataLinkTtlHours({ DATA_LINK_TTL_HOURS: '-5' })).toBe(24);
  });

  it('still resolves just before the 24h default expires', () => {
    vi.useFakeTimers();
    const link = sign(rows);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 60_000);
    expect(read(link)).toEqual(rows);
  });

  it('stops resolving once the 24h default has passed', () => {
    vi.useFakeTimers();
    const link = sign(rows);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 60_000);
    expect(read(link)).toBeNull();
  });

  it('honours a shortened DATA_LINK_TTL_HOURS end to end', () => {
    vi.useFakeTimers();
    const env = { ...TEST_ENV, DATA_LINK_TTL_HOURS: '1' };
    const link = sign(rows, env);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(read(link, env)).toEqual(rows);
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(read(link, env)).toBeNull();
  });

  it('drops the expired file from the store', () => {
    vi.useFakeTimers();
    sign(rows);
    expect(store.size()).toBe(1);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 60_000);
    expect(store.size()).toBe(0);
  });
});

describe('payload size cap', () => {
  it('defaults to 1.5 MB', () => {
    expect(getMaxPayloadSizeMb({})).toBe(DEFAULT_MAX_PAYLOAD_SIZE_MB);
    expect(DEFAULT_MAX_PAYLOAD_SIZE_MB).toBe(1.5);
  });

  it('refuses a payload over the cap', () => {
    const oversized = { blob: 'x'.repeat(1.6 * 1024 * 1024) };
    expect(() => sign(oversized)).toThrow(/Payload too large\. Maximum size is 1\.5MB\./);
  });

  it('does not persist anything when it refuses', () => {
    const oversized = { blob: 'x'.repeat(1.6 * 1024 * 1024) };
    expect(() => sign(oversized)).toThrow();
    expect(store.size()).toBe(0);
  });

  it('accepts a payload just under the cap', () => {
    const underSized = { blob: 'x'.repeat(1.4 * 1024 * 1024) };
    expect(() => sign(underSized)).not.toThrow();
  });

  it('reads the cap from MAX_PAYLOAD_SIZE_MB', () => {
    const env = { ...TEST_ENV, MAX_PAYLOAD_SIZE_MB: '0.001' };
    expect(getMaxPayloadSizeMb(env)).toBe(0.001);
    expect(() => sign({ blob: 'x'.repeat(5000) }, env)).toThrow(/Payload too large/);
  });
});

describe('secret handling', () => {
  it('refuses to sign in a production-like env with no secret', () => {
    expect(() => signDataLink(rows, { env: { NODE_ENV: 'production' }, store })).toThrow(
      /MCP_DATA_LINK_SECRET is empty/,
    );
  });

  it('refuses to sign in production with a known dev default', () => {
    expect(() =>
      signDataLink(rows, {
        env: { NODE_ENV: 'production', MCP_DATA_LINK_SECRET: 'changeme' },
        store,
      }),
    ).toThrow(/known development default/);
  });
});
