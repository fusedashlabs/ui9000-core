/**
 * Public data-link API: `signDataLink` / `readDataLink`.
 *
 * Assembled from mcp-ui `createDataLink` / `getDataLink`
 * (`src/utils/dataLinkHandlers.ts`) and the TTL resolution in
 * `chartDataLinkHelper.ts`. The signing and verification steps are unchanged —
 * see `signature.ts`.
 *
 * These two functions satisfy the `SignDataLink` / `ReadDataLink` contract in
 * `src/tool/data-channel.ts`: the payload never reaches the spec, only an
 * opaque `/v1/data-links/:id?sig=&exp=` handle does.
 */

import { randomUUID } from 'node:crypto';
import {
  DEFAULT_HOSTED_MCP_BASE_URL,
  isRemoteDataLinkBase,
  persistHostedDataLink,
  shouldRemotePersistDataLink,
  type PersistFetch,
} from './hosted.js';
import { requireDataLinkSecret } from './secret.js';
import { getDataLinkStore, type TtlStore } from './store.js';
import {
  createSignedDataUrl,
  isExpired,
  generateExpiration,
  parseSignedUrlParams,
  verifyDataLinkSignature,
} from './signature.js';

/** Matches `SignedLink` in `src/tool/data-channel.ts`. */
export type SignedLink = { dataUrl: string };

export const DEFAULT_TTL_HOURS = 24;
export const DEFAULT_MAX_PAYLOAD_SIZE_MB = 1.5;
/** Same hosted origin mcp-ui npx uses. Override with loopback `MCP_BASE_URL` for local `mcp:serve`. */
export const DEFAULT_BASE_URL = DEFAULT_HOSTED_MCP_BASE_URL;

export type DataLinkOptions = {
  baseUrl?: string;
  secret?: string;
  env?: NodeJS.ProcessEnv;
  store?: TtlStore;
  fetchImpl?: PersistFetch;
};

/** mcp-ui `getDataLinkTtlHours`: DATA_LINK_TTL_HOURS, floored, min 1, default 24. */
export function getDataLinkTtlHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DATA_LINK_TTL_HOURS;
  if (raw == null || raw === '') return DEFAULT_TTL_HOURS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_TTL_HOURS;
}

/** MAX_PAYLOAD_SIZE_MB, default 1.5. */
export function getMaxPayloadSizeMb(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.MAX_PAYLOAD_SIZE_MB || String(DEFAULT_MAX_PAYLOAD_SIZE_MB));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAYLOAD_SIZE_MB;
}

/**
 * Strip a trailing `/mcp` so `https://host/mcp` and `https://host` share the
 * same `/v1/data-links` API root (mcp-ui `normalizeDataLinkBaseUrl`).
 */
export function normalizeDataLinkBaseUrl(raw: string): string {
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

function resolveBaseUrl(options: DataLinkOptions, env: NodeJS.ProcessEnv): string {
  const raw = options.baseUrl || env.MCP_BASE_URL || DEFAULT_BASE_URL;
  return normalizeDataLinkBaseUrl(raw);
}

/**
 * Persist the payload and return an opaque signed handle.
 *
 * Refuses payloads over MAX_PAYLOAD_SIZE_MB (1.5 MB) — the cap is on the
 * serialized bytes, matching mcp-ui, so a link can never be larger than the
 * host is willing to serve back.
 *
 * Hosted stdio (Cursor / Claude) POSTs to `MCP_BASE_URL` when
 * `MCP_DATA_LINK_REMOTE_PERSIST` is set — same path as mcp-ui npx.
 */
export function signDataLink(
  payload: unknown,
  options: DataLinkOptions = {},
): SignedLink | Promise<SignedLink> {
  const env = options.env ?? process.env;
  const maxPayloadSizeMb = getMaxPayloadSizeMb(env);
  const maxPayloadSizeBytes = maxPayloadSizeMb * 1024 * 1024;

  const payloadSize = JSON.stringify(payload).length;
  if (payloadSize > maxPayloadSizeBytes) {
    throw new Error(`Payload too large. Maximum size is ${maxPayloadSizeMb}MB.`);
  }

  const ttlHours = getDataLinkTtlHours(env);
  const store = options.store ?? getDataLinkStore();
  const baseUrl = resolveBaseUrl(options, env);

  if (shouldRemotePersistDataLink(env) && isRemoteDataLinkBase(baseUrl)) {
    return persistHostedDataLink(payload, baseUrl, options.fetchImpl).then((hosted) => {
      store.set(hosted.id, payload, ttlHours * 60 * 60 * 1000);
      return { dataUrl: hosted.dataUrl };
    });
  }

  const secret = options.secret ?? requireDataLinkSecret(env);
  const id = randomUUID();
  const exp = generateExpiration(ttlHours);
  store.set(id, payload, ttlHours * 60 * 60 * 1000);
  return { dataUrl: createSignedDataUrl(baseUrl, id, exp, secret) };
}

/**
 * Resolve a signed handle back to its payload.
 *
 * Fails closed to `null` — an unparseable URL, a bad signature, an expired
 * `exp`, or a missing/expired file all read the same way to the caller, so a
 * forged handle learns nothing from the response.
 */
export function readDataLink(link: SignedLink, options: DataLinkOptions = {}): unknown {
  const env = options.env ?? process.env;
  const params = parseSignedUrlParams(link?.dataUrl ?? '');
  if (!params) return null;

  const secret = options.secret ?? requireDataLinkSecret(env);
  if (!verifyDataLinkSignature(params.id, params.exp, params.sig, secret)) {
    return null;
  }
  if (isExpired(params.exp)) {
    return null;
  }

  const store = options.store ?? getDataLinkStore();
  return store.get(params.id)?.payload ?? null;
}
