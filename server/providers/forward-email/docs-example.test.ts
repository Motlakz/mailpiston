import { expect, it } from 'vitest';

import { ForwardEmailNormalizer } from './normalizer';

/**
 * Pins the hand-written payload in `docs/manual-testing.md` against the real
 * normalizer.
 *
 * That document tells an operator to paste a JSON body into curl and expect a
 * capture. A copy-paste example that silently stops matching the code it
 * documents is worse than no example — it sends someone debugging their
 * credentials when the problem is the payload shape. This fails the build
 * instead.
 *
 * If the normalizer changes, update both this fixture and the doc together.
 */
const DOCS_BODY = `{"messageId":"<manual-001@example.net>","subject":"Manual test","date":"2026-09-06T10:00:00.000Z","text":"Sent by hand.","from":{"value":[{"address":"customer@example.net","name":"A Customer"}]},"to":{"value":[{"address":"support@your-test-domain.example","name":""}]},"recipients":["support@your-test-domain.example"],"attachments":[],"headerLines":[],"session":{"sender":"customer@example.net","recipient":"support@your-test-domain.example","arrivalDate":"2026-09-06T10:00:00.000Z","remoteAddress":"203.0.113.10"}}`;

it('normalizes the hand-written body from docs/manual-testing.md', async () => {
  const normalized = await new ForwardEmailNormalizer().normalizeInbound(
    JSON.parse(DOCS_BODY),
  );

  // The envelope recipient is what routing keys on, not the To: header.
  expect(normalized.recipient).toBe('support@your-test-domain.example');
  expect(normalized.from).toBe('customer@example.net');
  expect(normalized.subject).toBe('Manual test');
  expect(normalized.text).toBe('Sent by hand.');
  // The normalizer strips the angle brackets RFC 5322 wraps a Message-ID in.
  // Phase 6 has to put them back when it writes In-Reply-To / References.
  expect(normalized.messageId).toBe('manual-001@example.net');
  expect(normalized.attachments).toHaveLength(0);
});
