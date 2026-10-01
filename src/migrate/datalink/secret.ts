/**
 * Data-link secret resolution — copied from mcp-ui `src/utils/dataLinkSecret.ts`.
 *
 * The secret comes from the environment, never from source. Production-like
 * environments fail closed when it is missing, a known dev default, or too
 * short. A local install with no secret mints a random one and keeps it next
 * to the data-link store, so the published package never signs with a constant
 * an attacker can read out of npm.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveDataLinkStorageDir } from './store.js';

/** Known unsafe defaults that must never ship in production (FUS-3988 / MVP-P04). */
export const DEV_DATA_LINK_SECRETS = new Set([
  '',
  'dev-secret-key-for-testing',
  'secret',
  'changeme',
  'change-me',
  'password',
]);

export const DATA_LINK_SECRET_ENV = 'MCP_DATA_LINK_SECRET';

export type SecretOk = { ok: true; secret: string };
export type SecretFail = { ok: false; reason: string };

export function isProductionLikeEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = (env.NODE_ENV || '').trim().toLowerCase();
  const mcpEnv = (env.MCP_ENV || env.APP_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production' || nodeEnv === 'prod') return true;
  if (mcpEnv === 'production' || mcpEnv === 'prod' || mcpEnv === 'staging') return true;
  // Docker/prod env files often omit NODE_ENV; treat ENV_FILE=env.prod as production-like.
  const envFile = (env.ENV_FILE || '').trim().toLowerCase();
  if (envFile.includes('prod') || envFile.includes('staging')) return true;
  return false;
}

export function resolveDataLinkSecret(env: NodeJS.ProcessEnv = process.env): string {
  return (env[DATA_LINK_SECRET_ENV] || '').trim();
}

export function isUnsafeDataLinkSecret(secret: string): boolean {
  return DEV_DATA_LINK_SECRETS.has(secret.trim());
}

/**
 * Fail closed in production-like envs when the secret is missing or a known
 * default. Local/dev keeps working with defaults so tests stay simple.
 */
export function assertSafeDataLinkSecret(
  env: NodeJS.ProcessEnv = process.env,
): SecretOk | SecretFail {
  const secret = resolveDataLinkSecret(env);
  const productionLike = isProductionLikeEnv(env);

  if (!productionLike) {
    if (secret && !isUnsafeDataLinkSecret(secret) && secret.length >= 16) {
      return { ok: true, secret };
    }
    return { ok: true, secret: installSecret(env) };
  }

  if (!secret) {
    return {
      ok: false,
      reason: `${DATA_LINK_SECRET_ENV} is empty in a production-like environment. Set a strong secret before serving data-links.`,
    };
  }

  if (isUnsafeDataLinkSecret(secret)) {
    return {
      ok: false,
      reason: `${DATA_LINK_SECRET_ENV} matches a known development default. Rotate it in the secrets manager / host env (do not commit the new value).`,
    };
  }

  if (secret.length < 16) {
    return {
      ok: false,
      reason: `${DATA_LINK_SECRET_ENV} is shorter than 16 characters. Use a longer random secret in production.`,
    };
  }

  return { ok: true, secret };
}

const INSTALL_SECRET_NAME = 'data-link.secret';

/**
 * One random secret per storage directory. Created on first use, mode 0600,
 * reused so sign and read agree across restarts of the same install.
 */
function installSecret(env: NodeJS.ProcessEnv): string {
  const file = path.join(resolveDataLinkStorageDir(env), INSTALL_SECRET_NAME);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32 && !isUnsafeDataLinkSecret(existing)) return existing;
  } catch {
    // Missing or unreadable. Mint below.
  }
  const secret = randomBytes(32).toString('base64url');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // chmod is best-effort; the secret is still unguessable.
  }
  return secret;
}

/** Throwing wrapper for the signing path — never sign with an unsafe secret. */
export function requireDataLinkSecret(env: NodeJS.ProcessEnv = process.env): string {
  const result = assertSafeDataLinkSecret(env);
  if (!result.ok) {
    throw new Error(`Refusing to sign a data-link: ${result.reason}`);
  }
  return result.secret;
}
