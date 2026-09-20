import 'server-only';

import { ConflictError, NotFoundError } from '@/server/core/errors';
import type { Email, SpamSignal, SpamVerdict } from '@/server/core/types';
import type {
  EmailRepository,
  EventRepository,
} from '@/server/repositories/types';
import type { Storage } from '@/server/storage';

/**
 * What an operator can do to a message they are looking at (roadmap Phase 12).
 *
 * Every mutation in this file is reversible except one, and the shape of the
 * file is built around that asymmetry.
 *
 * Reclassifying, binning and restoring are all one column and a recorded event.
 * They can be undone, so they are ordinary buttons.
 *
 * Purging is not. It deletes the row and the bytes it references, and nothing
 * brings either back. So it is a separate method, on a separate route, reached
 * only from the bin — a place a message has to be put deliberately first. There
 * is no path from the mail list to permanent deletion in one action, and that
 * is the point.
 */
export class MailboxService {
  private readonly resolveStorage: () => Storage;

  constructor(
    private readonly emails: EmailRepository,
    private readonly events: EventRepository,
    storage: Storage | (() => Storage),
  ) {
    this.resolveStorage = typeof storage === 'function' ? storage : () => storage;
  }

  private async get(id: string): Promise<Email> {
    const email = await this.emails.findById(id);
    if (!email) throw new NotFoundError(`Email ${id} not found`);
    return email;
  }

  /**
   * "This is spam" / "this is not spam", by hand.
   *
   * The operator's decision replaces the engine's signals rather than joining
   * them, so the message can still explain why it is where it is — the answer
   * is now "because you said so", which is the most useful answer there is.
   *
   * It does not retro-fire the fan-out. Releasing a message from spam makes it
   * visible; it does not deliver a webhook the application was never expecting
   * and has no idea how to interpret hours after the fact. Re-sending a
   * delivery is a separate, explicit action on the Endpoints screen.
   */
  async reclassify(id: string, verdict: Exclude<SpamVerdict, 'suspicious'>): Promise<Email> {
    const email = await this.get(id);

    if (email.direction === 'outbound') {
      throw new ConflictError(
        'Outbound mail is not classified: it is sent by this deployment, not received by it.',
      );
    }

    const signals: SpamSignal[] =
      verdict === 'spam'
        ? [
            {
              rule: 'operator_marked_spam',
              category: email.spamCategory ?? 'phishing',
              score: 100,
              detail: 'marked as spam by the operator',
            },
          ]
        : [];

    const updated = await this.emails.setSpamVerdict(id, verdict, signals);

    await this.events.create({
      emailId: id,
      type: verdict === 'spam' ? 'email.quarantined' : 'email.released',
      metadata: {
        by: 'operator',
        from: email.from,
        previousVerdict: email.spamVerdict,
      },
    });

    return updated;
  }

  /** Into the bin. Reversible, and the bytes are untouched. */
  async bin(id: string): Promise<Email> {
    const email = await this.get(id);
    if (email.deletedAt) return email;

    const updated = await this.emails.softDelete(id);

    await this.events.create({
      emailId: id,
      type: 'email.deleted',
      metadata: { by: 'operator', from: email.from, subject: email.subject },
    });

    return updated;
  }

  async restore(id: string): Promise<Email> {
    const email = await this.get(id);
    if (!email.deletedAt) return email;

    const updated = await this.emails.restore(id);

    await this.events.create({
      emailId: id,
      type: 'email.restored',
      metadata: { by: 'operator', from: email.from },
    });

    return updated;
  }

  /**
   * Permanent deletion of one message.
   *
   * Refused unless the message is already in the bin. Two deliberate steps for
   * an irreversible action is not friction for its own sake — it is the only
   * protection there is against a misclick on a list of a hundred rows.
   *
   * No event is written, because there is nothing left for it to hang off: the
   * `mail_events` rows cascade with the message. The audit log on the route is
   * where a purge is recorded, and that is the correct place — it survives the
   * thing it describes.
   */
  async purge(id: string): Promise<{ id: string }> {
    const email = await this.get(id);

    if (!email.deletedAt) {
      throw new ConflictError(
        'Only a message in the bin can be permanently deleted. Bin it first.',
      );
    }

    const { storageKeys } = await this.emails.purgeOne(id);
    await this.deleteBytes(storageKeys);

    return { id };
  }

  /** Empties the bin. Same contract as `purge`, applied to everything in it. */
  async emptyBin(): Promise<{ count: number }> {
    const { count, storageKeys } = await this.emails.purgeDeleted();
    await this.deleteBytes(storageKeys);

    return { count };
  }

  /**
   * Bytes go after rows, and a failure here is logged rather than thrown.
   *
   * The rows are already gone by the time this runs, so throwing would report a
   * failure for an operation that has largely succeeded and cannot be retried.
   * What is left behind is an orphaned object — costs a little, references
   * nothing, and is collectable. That is the cheap failure, and it is the one
   * worth choosing.
   */
  private async deleteBytes(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    const storage = this.resolveStorage();

    for (const key of keys) {
      try {
        await storage.delete(key);
      } catch (error) {
        console.error(`Could not delete stored object ${key}`, error);
      }
    }
  }
}
