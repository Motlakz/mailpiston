import 'server-only';

import { env } from '@/server/core/config';

import { LocalStorage } from './local-storage';
import { r2StorageFromEnv } from './r2-storage';
import type { Storage } from './types';

export * from './types';
export { LocalStorage } from './local-storage';
export { R2Storage } from './r2-storage';

/**
 * Driver selection, by configuration rather than by flag.
 *
 * R2 wins whenever all four of its variables are present. The filesystem
 * driver is the development fallback and is refused in production, because a
 * serverless filesystem is per-instance and ephemeral: attachments written on
 * one invocation would be missing on the next, and the failure would look like
 * data loss rather than misconfiguration.
 */
let storage: Storage | undefined;

export function getStorage(): Storage {
  if (storage) return storage;

  const r2 = r2StorageFromEnv();

  if (r2) {
    storage = r2;
    return storage;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No object storage configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
        'R2_SECRET_ACCESS_KEY, and R2_BUCKET — the filesystem driver is ' +
        'development-only and would silently lose attachments here.',
    );
  }

  storage = new LocalStorage(env.LOCAL_STORAGE_DIR);
  return storage;
}

/** Test seam. Not used in production wiring. */
export function setStorage(next: Storage | undefined): void {
  storage = next;
}
