/**
 * Object storage (roadmap Phase 4, plan §18).
 *
 * Attachment bytes and raw MIME never go in Postgres. Everything that does go
 * to storage is content the database only references by key, so the interface
 * is deliberately tiny: put, get, delete, and an optional direct-download URL.
 *
 * `presignedUrl` returns `null` for drivers that cannot mint one (the local
 * development driver). Callers must handle that by streaming the bytes
 * themselves rather than assuming a URL always exists — see
 * `app/api/v1/attachments/[id]/download`.
 */
export interface StoredObject {
  key: string;
  sizeBytes: number;
}

export interface PutOptions {
  contentType: string;
  /** Suggested download filename, when the driver can carry one. */
  filename?: string;
}

export interface Storage {
  readonly id: 'r2' | 'local';
  put(key: string, body: Buffer, options: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  presignedUrl(key: string, ttlSeconds: number): Promise<string | null>;
}

/** `attachments/{emailId}/{attachmentId}` — plan §18. */
export function attachmentKey(emailId: string, attachmentId: string): string {
  return `attachments/${emailId}/${attachmentId}`;
}

/** `raw/{emailId}.eml` — only written when `STORE_RAW_MIME` is on. */
export function rawMimeKey(emailId: string): string {
  return `raw/${emailId}.eml`;
}
