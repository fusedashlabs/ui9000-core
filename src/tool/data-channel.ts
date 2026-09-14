import { signDataLink as signMigratedDataLink } from '../migrate/datalink/index.js';
import type { WorkspaceSpec } from '../spec/workspace-spec.js';

/** Widget-side fetch name. Not listed on tools/list — the model sees only show_workspace. */
export const CALL_SERVER_TOOL = 'read_workspace_data';

const HANDLE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HANDLE_QUERY_KEYS = new Set(['sig', 'exp']);

export type SignedLink = {
  dataUrl: string;
};

/** Default: migrate `signDataLink`. Tests may inject a stub. Do not implement the store here. */
export type SignDataLink = (payload: unknown) => SignedLink | Promise<SignedLink>;

export type ReadDataLink = (link: SignedLink) => unknown | Promise<unknown>;

export type AttachHandleOk = { ok: true; spec: WorkspaceSpec };
export type AttachHandleFail = {
  ok: false;
  code: 'empty_dataUrl' | 'leaky_handle';
  reason: string;
};

/**
 * Put a handle on the spec. The payload is signed, never copied onto the spec or summary.
 * dataUrl must be an opaque `/v1/data-links/:id` URL (optional `sig` / `exp` only).
 */
export async function attachDataHandle(
  spec: WorkspaceSpec,
  payload: unknown,
  signDataLink: SignDataLink = signMigratedDataLink,
): Promise<AttachHandleOk | AttachHandleFail> {
  const link = await signDataLink(payload);
  if (!link || typeof link.dataUrl !== 'string' || !link.dataUrl.trim()) {
    return {
      ok: false,
      code: 'empty_dataUrl',
      reason: 'signDataLink did not return a dataUrl.',
    };
  }
  const dataUrl = link.dataUrl.trim();
  if (!isOpaqueDataUrl(dataUrl)) {
    return {
      ok: false,
      code: 'leaky_handle',
      reason: 'dataUrl must be an opaque /v1/data-links/:id handle; it must not carry dataset rows.',
    };
  }
  return {
    ok: true,
    spec: {
      ...spec,
      dataUrl,
      callServerTool: CALL_SERVER_TOOL,
    },
  };
}

/** Widget path: rows come back only by resolving the handle. */
export async function readViaHandle(
  spec: Pick<WorkspaceSpec, 'dataUrl'>,
  readDataLink: ReadDataLink,
): Promise<unknown> {
  if (!spec.dataUrl) {
    throw new Error('spec has no data handle');
  }
  return readDataLink({ dataUrl: spec.dataUrl });
}

/** Allowlist: http(s) `/v1/data-links/:id` with optional HMAC query keys only. */
export function isOpaqueDataUrl(dataUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(dataUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password || url.hash) return false;
  const parts = url.pathname.split('/').filter((part) => part.length > 0);
  if (parts.length !== 3 || parts[0] !== 'v1' || parts[1] !== 'data-links') return false;
  if (!HANDLE_ID.test(parts[2])) return false;
  for (const key of url.searchParams.keys()) {
    if (!HANDLE_QUERY_KEYS.has(key)) return false;
  }
  return true;
}
