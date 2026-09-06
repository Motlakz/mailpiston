import 'server-only';

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { NotFoundError } from '@/server/core/errors';

import type { Storage, StoredObject } from './types';

/**
 * Filesystem storage for local development.
 *
 * This exists so that Phase 4 can be exercised end to end without a Cloudflare
 * account — not as a deployment target. Serverless filesystems are ephemeral
 * and per-instance, so `getStorage()` refuses to select this driver in
 * production.
 *
 * It cannot mint a direct-download URL, so `presignedUrl` returns `null` and
 * the download route streams the bytes instead.
 */
export class LocalStorage implements Storage {
  readonly id = 'local' as const;

  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, body: Buffer): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);

    return { key, sizeBytes: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      throw new NotFoundError(`No stored object at ${key}`);
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async presignedUrl(): Promise<null> {
    return null;
  }

  /**
   * Keys are built by us, but they interpolate an attachment id and, for raw
   * MIME, an email id — so the traversal check is cheap insurance rather than
   * paranoia. A key that escapes the root is hashed into a flat filename
   * instead of being written outside it.
   */
  private pathFor(key: string): string {
    const path = resolve(join(this.root, key));

    if (path !== this.root && !path.startsWith(this.root + sep)) {
      return join(this.root, createHash('sha256').update(key).digest('hex'));
    }

    return path;
  }
}
