import 'server-only';

import type { EmailRepository } from '@/server/repositories/types';
import type { Storage } from '@/server/storage';

/**
 * Retention (roadmap Phase 11).
 *
 * Two things are stored outside Postgres and both grow without limit: raw MIME
 * and attachment bytes. This prunes them on a schedule, and everything about it
 * is shaped by one rule — **metadata survives its content**.
 *
 * A pruned attachment keeps its row. "This message had a 4 MB PDF called
 * invoice.pdf, and we deleted it on the 3rd" is a complete answer to an
 * operator's question. Deleting the row instead leaves them looking at a
 * message that appears never to have had an attachment, which is a different
 * and much worse answer.
 *
 * **Bytes go before the row is marked**, which is the opposite of the inbound
 * pipeline's order and correct for the same reason. Crash after the delete and
 * the row is still unmarked, so the next sweep tries again — and deleting an
 * object that is already gone is a no-op in both storage drivers, so the retry
 * converges. Marking first and then failing to delete would leak an object
 * that nothing references and nothing can ever find again.
 *
 * No retention configured means nothing is pruned. The safe failure for a mail
 * archive is keeping too much, and an operator who has not chosen a policy has
 * not consented to one either.
 */
export interface RetentionPolicy {
  rawMimeDays?: number;
  attachmentDays?: number;
}

export interface RetentionResult {
  rawMimePruned: number;
  attachmentsPruned: number;
  bytesFreed: number;
  failures: number;
}

/**
 * Rows per sweep, per kind.
 *
 * The sweep runs daily and is resumable, so a backlog drains over several days
 * rather than in one pass that risks a function timeout partway through a
 * delete it cannot record.
 */
const BATCH = 500;

export class RetentionService {
  private readonly resolveStorage: () => Storage;

  constructor(
    private readonly emails: EmailRepository,
    storage: Storage | (() => Storage),
    private readonly policy: RetentionPolicy,
  ) {
    this.resolveStorage = typeof storage === 'function' ? storage : () => storage;
  }

  async prune(now: Date = new Date()): Promise<RetentionResult> {
    const result: RetentionResult = {
      rawMimePruned: 0,
      attachmentsPruned: 0,
      bytesFreed: 0,
      failures: 0,
    };

    if (!this.policy.rawMimeDays && !this.policy.attachmentDays) {
      return result;
    }

    const storage = this.resolveStorage();

    if (this.policy.rawMimeDays) {
      const cutoff = daysBefore(now, this.policy.rawMimeDays);

      for (const email of await this.emails.listPrunableRawMime(cutoff, BATCH)) {
        try {
          await storage.delete(email.rawStorageKey);
          await this.emails.clearRawStorageKey(email.id);
          result.rawMimePruned += 1;
        } catch (error) {
          // One unreachable object must not stop the sweep; the next row might
          // be the large one actually costing money.
          result.failures += 1;
          console.error('Failed to prune raw MIME', email.id, error);
        }
      }
    }

    if (this.policy.attachmentDays) {
      const cutoff = daysBefore(now, this.policy.attachmentDays);

      for (const attachment of await this.emails.listPrunableAttachments(
        cutoff,
        BATCH,
      )) {
        try {
          await storage.delete(attachment.storageKey);
          await this.emails.markAttachmentPruned(attachment.id);
          result.attachmentsPruned += 1;
          result.bytesFreed += attachment.sizeBytes;
        } catch (error) {
          result.failures += 1;
          console.error('Failed to prune attachment', attachment.id, error);
        }
      }
    }

    return result;
  }
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
