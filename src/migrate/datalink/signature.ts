/**
 * HMAC-SHA256 data-link signatures — copied from mcp-ui `src/utils/signature.ts`.
 *
 * The algorithm is load-bearing for interop: a link signed by mcp-ui must verify
 * here and vice versa. Do not "improve" the canonical string (`${id}.${exp}`),
 * the base64url digest encoding, or the epoch-seconds `exp`. Changing any of
 * them silently invalidates every link the other side issued.
 *
 * mcp-ui's exported `signDataLink` (id/exp/secret -> digest) is named
 * `computeDataLinkSignature` here so it does not collide with this package's
 * public `signDataLink(payload) -> SignedLink`. The body is unchanged.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureParams = {
  id: string;
  exp: number;
  secret: string;
};

export type SignedUrlParams = {
  id: string;
  sig: string;
  exp: number;
};

/** mcp-ui `signDataLink`: base64url HMAC-SHA256 over `${id}.${exp}`. */
export function computeDataLinkSignature({ id, exp, secret }: SignatureParams): string {
  const payload = `${id}.${exp}`;
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('base64url');
}

/** Constant-time compare, and expired links never verify. */
export function verifyDataLinkSignature(
  id: string,
  exp: number,
  sig: string,
  secret: string,
): boolean {
  if (Date.now() / 1000 > exp) {
    return false;
  }

  const expectedSig = computeDataLinkSignature({ id, exp, secret });

  const expectedBuffer = Buffer.from(expectedSig, 'base64url');
  const providedBuffer = Buffer.from(sig, 'base64url');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/** Opaque handle shape: `/v1/data-links/:id?sig=&exp=` and nothing else. */
export function createSignedDataUrl(
  baseUrl: string,
  id: string,
  exp: number,
  secret: string,
): string {
  const sig = computeDataLinkSignature({ id, exp, secret });
  return `${baseUrl}/v1/data-links/${id}?sig=${sig}&exp=${exp}`;
}

export function parseSignedUrlParams(url: string): SignedUrlParams | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const id = pathParts[pathParts.length - 1];
    const sig = urlObj.searchParams.get('sig');
    const expStr = urlObj.searchParams.get('exp');

    if (!id || !sig || !expStr) {
      return null;
    }

    const exp = parseInt(expStr, 10);
    if (isNaN(exp)) {
      return null;
    }

    return { id, sig, exp };
  } catch {
    return null;
  }
}

export function generateExpiration(hoursFromNow: number = 24): number {
  return Math.floor(Date.now() / 1000) + hoursFromNow * 60 * 60;
}

export function isExpired(timestamp: number): boolean {
  return Date.now() / 1000 > timestamp;
}
