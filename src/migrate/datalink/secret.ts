/**
 * Data-link secret resolution — copied from mcp-ui `src/utils/dataLinkSecret.ts`.
 *
 * The secret comes from the environment, never from source. Production-like
 * environments fail closed when it is missing, a known dev default, or too
 * short; local and test keep the dev fallback so stdio and vitest stay simple.
 */

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
    return { ok: true, secret: secret || 'dev-secret-key-for-testing' };
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

/** Throwing wrapper for the signing path — never sign with an unsafe secret. */
export function requireDataLinkSecret(env: NodeJS.ProcessEnv = process.env): string {
  const result = assertSafeDataLinkSecret(env);
  if (!result.ok) {
    throw new Error(`Refusing to sign a data-link: ${result.reason}`);
  }
  return result.secret;
}
