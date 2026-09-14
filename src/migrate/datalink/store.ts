/**
 * Filesystem TTL store — copied from mcp-ui `src/utils/dataLinkStore.ts`.
 *
 * Same role as mcp-ui's `.data/`: one JSON file per link id, each wrapping the
 * payload in a `{ value, exp }` envelope so an expired file is dropped on the
 * next touch rather than lingering. Reads and writes are sync on purpose — the
 * store is small and the signing path must not interleave.
 *
 * Deviation from mcp-ui: the stored record carries an opaque `payload` instead
 * of mcp-ui's `{ config, data }` split, because this package's contract
 * (`SignDataLink = (payload: unknown) => SignedLink`) signs arbitrary payloads.
 * The envelope, file layout, and expiry mechanics are unchanged.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export type StoredDataLink = {
  id: string;
  createdAt: string;
  ttlSeconds: number;
  payload: unknown;
};

type Envelope = { value: StoredDataLink; exp: number };

/** `packages/core` — the root a relative STORAGE_DIR resolves against. */
function packageRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

/**
 * Resolve the on-disk TTL store directory.
 * Cursor/Claude stdio often have cwd=$HOME, so `path.resolve(cwd, '.data')`
 * would write to ~/.data while the server reads the package `.data` — the
 * links then 404. Default: `<packageRoot>/.data` unless STORAGE_DIR is absolute.
 */
export function resolveDataLinkStorageDir(
  env: NodeJS.ProcessEnv = process.env,
  root: string = packageRoot(),
): string {
  const raw = (env.STORAGE_DIR || '.data').trim() || '.data';
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(root, raw);
}

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class TtlStore {
  private readonly defaultTtlMs: number;
  private readonly dataDir: string;

  constructor(defaultTtlMs: number = DEFAULT_TTL_MS, dataDir?: string) {
    this.defaultTtlMs = defaultTtlMs;
    this.dataDir = dataDir ?? resolveDataLinkStorageDir();
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private filePathFor(id: string): string {
    return path.join(this.dataDir, `${id}.json`);
  }

  set(id: string, payload: unknown, customTtlMs?: number): void {
    const ttlMs = customTtlMs || this.defaultTtlMs;
    const now = Date.now();
    const createdAt = new Date(now).toISOString();

    const value: StoredDataLink = {
      id,
      createdAt,
      ttlSeconds: Math.floor(ttlMs / 1000),
      payload,
    };

    const envelope: Envelope = { value, exp: now + ttlMs };
    // Fail closed: a signed URL with no file on disk is a 404. mcp-ui swallowed
    // this write; we do not — signDataLink must not return a dead handle.
    this.ensureDir();
    fs.writeFileSync(this.filePathFor(id), JSON.stringify(envelope), 'utf8');
    this.cleanup();
  }

  get(id: string): StoredDataLink | null {
    this.cleanup();
    const file = this.filePathFor(id);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as Envelope;
      if (Date.now() > parsed.exp) {
        this.unlinkQuietly(file);
        return null;
      }
      return parsed.value;
    } catch (err) {
      console.error('Failed to read data link:', err);
      return null;
    }
  }

  has(id: string): boolean {
    return this.get(id) !== null;
  }

  delete(id: string): boolean {
    const file = this.filePathFor(id);
    if (!fs.existsSync(file)) return false;
    try {
      fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  }

  size(): number {
    this.cleanup();
    return this.linkFiles().length;
  }

  /** Drop every link. Used by tests and by store teardown. */
  destroy(): void {
    for (const file of this.linkFiles()) {
      this.unlinkQuietly(file);
    }
  }

  private linkFiles(): string[] {
    try {
      if (!fs.existsSync(this.dataDir)) return [];
      return fs
        .readdirSync(this.dataDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(this.dataDir, f));
    } catch {
      return [];
    }
  }

  private unlinkQuietly(file: string): void {
    try {
      fs.unlinkSync(file);
    } catch {
      // A concurrent reader already removed it — expiry is idempotent.
    }
  }

  /** Sweep expired (and unreadable) files so the directory cannot grow forever. */
  private cleanup(): void {
    const now = Date.now();
    for (const file of this.linkFiles()) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { exp: number };
        if (now > parsed.exp) this.unlinkQuietly(file);
      } catch {
        // Corrupt or truncated file: it can never be served, so drop it.
        this.unlinkQuietly(file);
      }
    }
  }
}

let store: TtlStore | null = null;

export function getDataLinkStore(): TtlStore {
  if (!store) {
    store = new TtlStore();
  }
  return store;
}

/** Test-only: drop the singleton so STORAGE_DIR can be re-read. */
export function resetDataLinkStoreForTests(): void {
  if (store) {
    try {
      store.destroy();
    } catch {
      // Teardown is best-effort.
    }
  }
  store = null;
}
