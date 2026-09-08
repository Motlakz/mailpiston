import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryEmailRepository,
  InMemoryStorage,
  InMemoryThreadRepository,
} from '@/server/test/in-memory-repositories';
import { attachmentKey, rawMimeKey } from '@/server/storage';

import { RetentionService } from './retention-service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-08T00:00:00.000Z');

let emails: InMemoryEmailRepository;
let storage: InMemoryStorage;

/**
 * Captures a message with raw MIME and an attachment, dated `daysAgo`.
 *
 * `createdAt` is set directly afterwards because the fake stamps it with the
 * wall clock, and everything retention does is a comparison against that.
 */
async function capture(daysAgo: number, id = `em_${daysAgo}`) {
  const when = new Date(NOW.getTime() - daysAgo * DAY);

  await storage.put(rawMimeKey(id), Buffer.from('raw mime'));
  await storage.put(attachmentKey(id, 'att'), Buffer.from('pdf bytes'));

  const result = await emails.createInbound({
    email: {
      id,
      threadId: null,
      addressId: null,
      providerMessageId: id,
      messageId: `<${id}@example.com>`,
      fingerprint: `fp_${id}`,
      direction: 'inbound',
      status: 'received',
      from: 'customer@example.com',
      to: ['support@example.test'],
      cc: [],
      subject: 'Hello',
      text: 'Hi',
      html: null,
      inReplyTo: null,
      references: [],
      rawStorageKey: rawMimeKey(id),
      receivedAt: when,
      sentAt: null,
    },
    attachments: [
      {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        sizeBytes: 9,
        storageKey: attachmentKey(id, 'att'),
      },
    ],
    eventMetadata: {},
    thread: { subject: 'Hello' },
  });

  emails.rows.set(id, { ...result.email!, createdAt: when });

  for (const [attachmentId, attachment] of emails.attachments) {
    if (attachment.emailId === id) {
      emails.attachments.set(attachmentId, { ...attachment, createdAt: when });
    }
  }

  return id;
}

beforeEach(() => {
  const threads = new InMemoryThreadRepository();
  emails = new InMemoryEmailRepository(threads);
  storage = new InMemoryStorage();
});

describe('with no policy configured', () => {
  it('prunes nothing at all', async () => {
    // The safe failure for a mail archive is keeping too much, and an operator
    // who has not chosen a policy has not consented to one either.
    await capture(400);

    const result = await new RetentionService(emails, storage, {}).prune(NOW);

    expect(result).toEqual({
      rawMimePruned: 0,
      attachmentsPruned: 0,
      bytesFreed: 0,
      failures: 0,
    });
    expect(storage.objects.size).toBe(2);
  });
});

describe('raw MIME retention', () => {
  it('prunes bytes older than the policy and clears the key', async () => {
    const id = await capture(40);

    const result = await new RetentionService(emails, storage, {
      rawMimeDays: 30,
    }).prune(NOW);

    expect(result.rawMimePruned).toBe(1);
    expect(storage.objects.has(rawMimeKey(id))).toBe(false);
    expect((await emails.findById(id))?.rawStorageKey).toBeNull();
  });

  it('leaves messages inside the window alone', async () => {
    const id = await capture(10);

    await new RetentionService(emails, storage, { rawMimeDays: 30 }).prune(NOW);

    expect(storage.objects.has(rawMimeKey(id))).toBe(true);
    expect((await emails.findById(id))?.rawStorageKey).not.toBeNull();
  });

  it('leaves the parsed message untouched', async () => {
    // Raw MIME is a debugging artifact. Pruning it must not cost the operator
    // the message itself.
    const id = await capture(40);

    await new RetentionService(emails, storage, { rawMimeDays: 30 }).prune(NOW);

    const email = await emails.findById(id);
    expect(email?.subject).toBe('Hello');
    expect(email?.text).toBe('Hi');
  });
});

describe('attachment retention', () => {
  it('deletes the bytes and keeps the metadata row', async () => {
    // "This message had a 4 MB PDF called invoice.pdf, and we deleted it on the
    // 3rd" is a complete answer. A message that appears never to have had an
    // attachment is not.
    const id = await capture(120);

    const result = await new RetentionService(emails, storage, {
      attachmentDays: 90,
    }).prune(NOW);

    expect(result.attachmentsPruned).toBe(1);
    expect(result.bytesFreed).toBe(9);
    expect(storage.objects.has(attachmentKey(id, 'att'))).toBe(false);

    const [attachment] = await emails.listAttachments(id);
    expect(attachment.filename).toBe('invoice.pdf');
    expect(attachment.sizeBytes).toBe(9);
    expect(attachment.prunedAt).not.toBeNull();
  });

  it('does not prune the same attachment twice', async () => {
    const id = await capture(120);
    const service = new RetentionService(emails, storage, { attachmentDays: 90 });

    await service.prune(NOW);
    const second = await service.prune(NOW);

    expect(second.attachmentsPruned).toBe(0);
    expect(second.bytesFreed).toBe(0);
    // Skipped because the row is marked, not because the object happens to be
    // gone — which is what keeps the sweep's own numbers meaningful.
    expect(storage.objects.has(attachmentKey(id, 'att'))).toBe(false);
  });

  it('applies each policy independently', async () => {
    // A short raw-MIME window and a long attachment window is the expected
    // configuration: raw MIME is the bulk of the bill and the least valuable.
    const id = await capture(60);

    const result = await new RetentionService(emails, storage, {
      rawMimeDays: 30,
      attachmentDays: 365,
    }).prune(NOW);

    expect(result.rawMimePruned).toBe(1);
    expect(result.attachmentsPruned).toBe(0);
    expect(storage.objects.has(attachmentKey(id, 'att'))).toBe(true);
  });
});

describe('when storage will not cooperate', () => {
  it('counts the failure, leaves the row unmarked, and keeps going', async () => {
    // An unmarked row is what makes the sweep resumable: the next run tries
    // again, and deleting an object that is already gone is a no-op in both
    // drivers, so the retry converges rather than erroring.
    const newer = await capture(120, 'em_a');
    const oldest = await capture(121, 'em_b');

    // The sweep runs oldest first, so this rejection lands on `oldest`.
    vi.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('R2 unreachable'));

    const result = await new RetentionService(emails, storage, {
      attachmentDays: 90,
    }).prune(NOW);

    expect(result.failures).toBe(1);
    // One unreachable object must not stop the sweep — the next row might be
    // the large one actually costing money.
    expect(result.attachmentsPruned).toBe(1);

    expect((await emails.listAttachments(oldest))[0].prunedAt).toBeNull();
    expect((await emails.listAttachments(newer))[0].prunedAt).not.toBeNull();
  });

  it('recovers on the next sweep', async () => {
    const id = await capture(120);
    const service = new RetentionService(emails, storage, { attachmentDays: 90 });

    vi.spyOn(storage, 'delete').mockRejectedValueOnce(new Error('R2 unreachable'));
    await service.prune(NOW);

    const second = await service.prune(NOW);

    expect(second.attachmentsPruned).toBe(1);
    expect((await emails.listAttachments(id))[0].prunedAt).not.toBeNull();
  });
});
