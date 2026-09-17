/**
 * Hosted data-link origin — same remote mcp-ui npx uses (`https://mcp.ui9000.com`).
 * Stdio (Cursor / Claude) POSTs payloads there so mcp.json needs no env.
 * In-process tests and loopback `MCP_BASE_URL` keep the local TTL store.
 */

export const DEFAULT_HOSTED_MCP_BASE_URL = 'https://mcp.ui9000.com';

/** Set by `startWorkspaceServer` in hosted mode. Tests and loopback must not set this. */
export const REMOTE_PERSIST_ENV = 'MCP_DATA_LINK_REMOTE_PERSIST';

export const HOSTED_DATA_LINK_PERSIST_TIMEOUT_MS = 15_000;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type PersistFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<Pick<Response, 'ok' | 'status' | 'json' | 'text'>>;

export function isRemoteDataLinkBase(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return !LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function shouldRemotePersistDataLink(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[REMOTE_PERSIST_ENV] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function enableRemotePersist(env: NodeJS.ProcessEnv): void {
  env[REMOTE_PERSIST_ENV] = '1';
}

export function dataLinkCreateUrl(baseUrl: string): string {
  return `${normalizeHostedBaseUrl(baseUrl)}/v1/data-links`;
}

function normalizeHostedBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.pathname.replace(/\/+$/, '') === '/mcp') return url.origin;
    return trimmed;
  } catch {
    return trimmed;
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError',
  );
}

export async function persistHostedDataLink(
  payload: unknown,
  baseUrl: string,
  fetchImpl: PersistFetch = fetch as PersistFetch,
): Promise<{ id: string; dataUrl: string }> {
  const url = dataLinkCreateUrl(baseUrl);
  let response: Pick<Response, 'ok' | 'status' | 'json' | 'text'>;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: { source: 'show_workspace' },
        data: payload,
      }),
      signal: AbortSignal.timeout(HOSTED_DATA_LINK_PERSIST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        `Hosted data-link save timed out after ${HOSTED_DATA_LINK_PERSIST_TIMEOUT_MS}ms at ${url}`,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Hosted data-link save failed at ${url}: ${detail.slice(0, 300)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Hosted data-link save failed (${response.status}) at ${url}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
    );
  }

  const body = (await response.json()) as { id?: string; dataUrl?: string };
  if (!body?.id || typeof body.dataUrl !== 'string' || !body.dataUrl) {
    throw new Error(`Hosted data-link save returned an invalid body from ${url}`);
  }

  let dataOrigin: string;
  let expectedOrigin: string;
  try {
    dataOrigin = new URL(body.dataUrl).origin;
    expectedOrigin = new URL(normalizeHostedBaseUrl(baseUrl)).origin;
  } catch {
    throw new Error('Hosted data-link save returned an invalid dataUrl');
  }
  if (dataOrigin !== expectedOrigin) {
    throw new Error(
      `Hosted data-link save returned a dataUrl origin (${dataOrigin}) that does not match ${expectedOrigin}`,
    );
  }

  return { id: body.id, dataUrl: body.dataUrl };
}
