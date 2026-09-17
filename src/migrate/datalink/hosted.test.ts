import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HOSTED_MCP_BASE_URL,
  REMOTE_PERSIST_ENV,
  dataLinkCreateUrl,
  enableRemotePersist,
  isRemoteDataLinkBase,
  persistHostedDataLink,
  shouldRemotePersistDataLink,
} from './hosted.js';

describe('hosted data-link origin', () => {
  it('treats mcp.ui9000.com as remote and loopback as local', () => {
    expect(isRemoteDataLinkBase(DEFAULT_HOSTED_MCP_BASE_URL)).toBe(true);
    expect(isRemoteDataLinkBase('https://mcp.ui9000.com/mcp')).toBe(true);
    expect(isRemoteDataLinkBase('http://127.0.0.1:8088')).toBe(false);
    expect(isRemoteDataLinkBase('http://localhost:8088')).toBe(false);
  });

  it('POSTs to /v1/data-links on the hosted origin', () => {
    expect(dataLinkCreateUrl(DEFAULT_HOSTED_MCP_BASE_URL)).toBe(
      'https://mcp.ui9000.com/v1/data-links',
    );
  });

  it('enables persist only when the env flag is set', () => {
    expect(shouldRemotePersistDataLink({})).toBe(false);
    const env: NodeJS.ProcessEnv = {};
    enableRemotePersist(env);
    expect(env[REMOTE_PERSIST_ENV]).toBe('1');
    expect(shouldRemotePersistDataLink(env)).toBe(true);
  });

  it('rejects a host body whose dataUrl origin does not match the POST origin', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'hosted-id',
        dataUrl: 'http://localhost:5173/v1/data-links/hosted-id?sig=a&exp=1',
      }),
      text: async () => '',
    }));

    await expect(
      persistHostedDataLink({ name: 'probe' }, DEFAULT_HOSTED_MCP_BASE_URL, fetchImpl),
    ).rejects.toThrow(/does not match/);
  });

  it('throws when the host rejects the POST', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => '{"error":"Too many requests"}',
    }));

    await expect(
      persistHostedDataLink({}, DEFAULT_HOSTED_MCP_BASE_URL, fetchImpl),
    ).rejects.toThrow(/429/);
  });
});
