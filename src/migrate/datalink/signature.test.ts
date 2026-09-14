import { describe, expect, it } from 'vitest';
import { isOpaqueDataUrl } from '../../tool/data-channel.js';
import {
  computeDataLinkSignature,
  createSignedDataUrl,
  generateExpiration,
  isExpired,
  parseSignedUrlParams,
  verifyDataLinkSignature,
} from './signature.js';

// Never a real secret — the signing secret comes from the environment.
const SECRET = 'test-secret-not-production';
const FAR_FUTURE = 1893456000; // 2030-01-01Z, well past any test run.

describe('computeDataLinkSignature', () => {
  // Golden vectors. If these change, links signed by mcp-ui stop verifying here.
  it('matches the mcp-ui HMAC-SHA256 base64url digest', () => {
    expect(computeDataLinkSignature({ id: 'abc123', exp: FAR_FUTURE, secret: SECRET })).toBe(
      'fAIX01ZTD_lgilm8_2_tsikdcGjelHtWaU6jQLfAmFs',
    );
    expect(
      computeDataLinkSignature({ id: 'link-1', exp: 1700000000, secret: 'another-secret' }),
    ).toBe('k9Oe6PclOUudVHkbABe3ntCMzAN59fGss8bOOnuuWOc');
  });

  it('is base64url, so it survives a query string unescaped', () => {
    const sig = computeDataLinkSignature({ id: 'abc123', exp: FAR_FUTURE, secret: SECRET });
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(sig)).toBe(sig);
  });

  it('binds the signature to both id and exp', () => {
    const base = computeDataLinkSignature({ id: 'abc123', exp: FAR_FUTURE, secret: SECRET });
    expect(computeDataLinkSignature({ id: 'abc124', exp: FAR_FUTURE, secret: SECRET })).not.toBe(
      base,
    );
    expect(computeDataLinkSignature({ id: 'abc123', exp: FAR_FUTURE + 1, secret: SECRET })).not.toBe(
      base,
    );
  });

  it('is deterministic for the same inputs', () => {
    const params = { id: 'abc123', exp: FAR_FUTURE, secret: SECRET };
    expect(computeDataLinkSignature(params)).toBe(computeDataLinkSignature(params));
  });
});

describe('verifyDataLinkSignature', () => {
  const sig = computeDataLinkSignature({ id: 'abc123', exp: FAR_FUTURE, secret: SECRET });

  it('accepts a signature it just produced', () => {
    expect(verifyDataLinkSignature('abc123', FAR_FUTURE, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered signature of the same length', () => {
    const tampered = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyDataLinkSignature('abc123', FAR_FUTURE, tampered, SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const other = computeDataLinkSignature({ id: 'abc123', exp: FAR_FUTURE, secret: 'other' });
    expect(verifyDataLinkSignature('abc123', FAR_FUTURE, other, SECRET)).toBe(false);
  });

  it('rejects a signature replayed onto a different id or exp', () => {
    expect(verifyDataLinkSignature('abc124', FAR_FUTURE, sig, SECRET)).toBe(false);
    expect(verifyDataLinkSignature('abc123', FAR_FUTURE - 1, sig, SECRET)).toBe(false);
  });

  // timingSafeEqual throws on length mismatch — the guard must catch it first.
  it('returns false rather than throwing on a wrong-length signature', () => {
    expect(() => verifyDataLinkSignature('abc123', FAR_FUTURE, 'short', SECRET)).not.toThrow();
    expect(verifyDataLinkSignature('abc123', FAR_FUTURE, 'short', SECRET)).toBe(false);
    expect(verifyDataLinkSignature('abc123', FAR_FUTURE, '', SECRET)).toBe(false);
  });

  it('rejects an expired link even when the signature is genuine', () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    const expiredSig = computeDataLinkSignature({ id: 'abc123', exp: past, secret: SECRET });
    expect(verifyDataLinkSignature('abc123', past, expiredSig, SECRET)).toBe(false);
  });
});

describe('TTL helpers', () => {
  it('generateExpiration defaults to 24 hours out, in epoch seconds', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(generateExpiration()).toBeCloseTo(now + 24 * 60 * 60, -1);
  });

  it('generateExpiration honours a custom hour count', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(generateExpiration(1)).toBeCloseTo(now + 60 * 60, -1);
  });

  it('isExpired is true only for past timestamps', () => {
    expect(isExpired(Math.floor(Date.now() / 1000) - 1)).toBe(true);
    expect(isExpired(FAR_FUTURE)).toBe(false);
  });
});

describe('signed URL shape', () => {
  it('produces an opaque handle the data channel accepts', () => {
    const url = createSignedDataUrl('https://workspace.local', 'abc123', FAR_FUTURE, SECRET);
    expect(url).toBe(
      `https://workspace.local/v1/data-links/abc123?sig=fAIX01ZTD_lgilm8_2_tsikdcGjelHtWaU6jQLfAmFs&exp=${FAR_FUTURE}`,
    );
    expect(isOpaqueDataUrl(url)).toBe(true);
  });

  it('round-trips through parseSignedUrlParams', () => {
    const url = createSignedDataUrl('https://workspace.local', 'abc123', FAR_FUTURE, SECRET);
    const parsed = parseSignedUrlParams(url);
    expect(parsed).toEqual({
      id: 'abc123',
      sig: computeDataLinkSignature({ id: 'abc123', exp: FAR_FUTURE, secret: SECRET }),
      exp: FAR_FUTURE,
    });
  });

  it('returns null for a url missing sig, exp, or a parseable exp', () => {
    expect(parseSignedUrlParams('https://workspace.local/v1/data-links/abc123')).toBeNull();
    expect(parseSignedUrlParams('https://workspace.local/v1/data-links/abc?sig=x')).toBeNull();
    expect(parseSignedUrlParams('https://workspace.local/v1/data-links/abc?sig=x&exp=nope')).toBeNull();
    expect(parseSignedUrlParams('not a url')).toBeNull();
  });
});
