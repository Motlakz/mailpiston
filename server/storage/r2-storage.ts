import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/server/core/config';
import { ExternalAPIError } from '@/server/core/errors';

import type { PutOptions, Storage, StoredObject } from './types';

/**
 * Cloudflare R2 over the S3 API.
 *
 * R2 is S3-compatible but not S3: the region is always `auto`, and the
 * endpoint is account-scoped rather than region-scoped. Both are hard-coded
 * here rather than made configurable, because getting either wrong produces a
 * confusing signature error rather than a useful one.
 */
export class R2Storage implements Storage {
  readonly id = 'r2' as const;

  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(
    key: string,
    body: Buffer,
    options: PutOptions,
  ): Promise<StoredObject> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          ContentDisposition: options.filename
            ? `attachment; filename="${sanitizeFilename(options.filename)}"`
            : undefined,
        }),
      );
    } catch (error) {
      throw new ExternalAPIError(`R2 put ${key} failed: ${describe(error)}`, 'r2');
    }

    return { key, sizeBytes: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new Error('empty body');

      return Buffer.from(bytes);
    } catch (error) {
      throw new ExternalAPIError(`R2 get ${key} failed: ${describe(error)}`, 'r2');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      throw new ExternalAPIError(`R2 delete ${key} failed: ${describe(error)}`, 'r2');
    }
  }

  async presignedUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Attachment filenames arrive from strangers. A quote or newline here would
 * let a sender inject arbitrary directives into the Content-Disposition
 * header, so only a conservative set of characters survives.
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'attachment';
}

export function r2StorageFromEnv(): R2Storage | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } =
    env;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    return null;
  }

  return new R2Storage({
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  });
}
