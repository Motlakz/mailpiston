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
}): string {
  return [
    input.provider,
    input.providerMessageId ?? '',
    input.messageId ?? '',
    input.recipient.toLowerCase(),
    input.addressId ?? '',
  ].join(':');
}
