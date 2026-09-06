#!/usr/bin/env node
/**
 * Fire a signed inbound delivery at a running dev server.
 *
 * The signature covers the raw request bytes, so this script serialises the
 * fixture exactly once and sends those same bytes — re-serialising anywhere in
 * between is precisely the mistake the verifier is built to catch.
 *
 * Usage:
 *   node scripts/post-inbound.mjs plain-text support@your-domain.test
 *   node scripts/post-inbound.mjs with-attachment support@your-domain.test
 *
 * Run it twice with the same arguments to see the idempotency path: the second
 * response is `{"status":"duplicate"}` and no second row appears in the Inbox.
 *
 * Reads FORWARD_EMAIL_WEBHOOK_KEY and APP_URL from .env.local. This is a
 * development tool and lives outside the app, so it reads the file directly
 * rather than going through server/core/config.ts.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const [fixtureName = 'plain-text', recipient] = process.argv.slice(2);

if (!recipient) {
  console.error(
    'Usage: node scripts/post-inbound.mjs <fixture> <recipient@your-domain>\n' +
      'Fixtures: plain-text, html, reply, bcc-only, with-attachment',
  );
  process.exit(1);
}

const envFile = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
    }),
);

const key = process.env.FORWARD_EMAIL_WEBHOOK_KEY ?? envFile.FORWARD_EMAIL_WEBHOOK_KEY;
const appUrl = process.env.APP_URL ?? envFile.APP_URL ?? 'http://localhost:3000';

if (!key) {
  console.error('FORWARD_EMAIL_WEBHOOK_KEY is not set in .env.local.');
  process.exit(1);
}

const fixture = JSON.parse(
  readFileSync(
    join(root, 'server/providers/forward-email/__fixtures__', `${fixtureName}.json`),
    'utf8',
  ),
);

// Point the delivery at the address under test. `session.recipient` is the
// envelope recipient — the field routing actually keys on — and `recipients`
// is the diagnostic list beside it.
fixture.session = { ...fixture.session, recipient };
fixture.recipients = [recipient];

// Give each run a distinct Message-ID unless one is pinned, so repeated runs
// build up an inbox instead of all colliding on the fixture's own id.
if (!process.env.PIN_MESSAGE_ID) {
  fixture.messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@example.com>`;
}

const body = JSON.stringify(fixture);
const signature = createHmac('sha256', key).update(body, 'utf8').digest('hex');

const response = await fetch(new URL('/api/providers/forward-email/inbound', appUrl), {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
  },
  body,
});

console.log(response.status, await response.text());
