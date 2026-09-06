import { createHash } from 'node:crypto';

/**
 * Fingerprint for one inbound delivery (execution plan §10.1), extended with
 * the resolved `addressId` per roadmap Phase 4.
 *
 * The extension matters: a single message addressed to two of our managed
 * addresses arrives as two separate provider POSTs that share a `Message-ID`.
 * Without the address in the key those two deliveries collapse into one row and
 * the second address silently never sees its mail.
 *
 * Deliberately free of any database or config import so it can be unit tested
 * on its own — this function is the one thing standing between us and duplicate
 * customer emails.
 */
export function createInboundFingerprint(input: {
  provider: string;
  providerMessageId?: string | null;
  messageId?: string | null;
  recipient: string;
  addressId?: string | null;
  /**
   * Anything that distinguishes this message from the next one, used only when
   * the delivery carries no id at all. See `contentDigest` below.
   */
  contentFallback?: string | null;
}): string {
  const hasId = Boolean(input.providerMessageId || input.messageId);

  return [
    input.provider,
    input.providerMessageId ?? '',
    input.messageId ?? '',
    input.recipient.toLowerCase(),
    input.addressId ?? '',
    // Without this, a delivery with neither a provider id nor a Message-ID
    // produces a key made entirely of the provider, recipient and address —
    // identical for *every* message that sender→address pair ever exchanges.
    // The first one would store and every one after it would be discarded as a
    // duplicate. Message-ID is mandated by RFC 5322 but is not guaranteed to
    // survive every relay, so this path is reachable in production.
    hasId ? '' : contentDigest(input.contentFallback ?? ''),
  ].join(':');
}

/**
 * Content hash used in place of a missing id.
 *
 * A genuine provider retry re-sends byte-identical content, so it still
 * deduplicates. Two different messages hash differently, so neither is lost.
 * The remaining false positive — the same sender sending the same bytes twice
 * on purpose — is the correct trade against silently dropping mail.
 */
function contentDigest(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}
