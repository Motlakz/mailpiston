# @mailpiston/sdk

Types, webhook verification, and a small API client for MailPiston.

No dependencies, and no `node:` imports — signing uses Web Crypto, so the same
module runs in Node, Bun, Deno, Cloudflare Workers, and on the edge.

## Verifying a webhook

```ts
import { verifyWebhook, isMailpistonEvent } from '@mailpiston/sdk';

export async function POST(request: Request) {
  let event;

  try {
    event = await verifyWebhook(request, process.env.MAILPISTON_ENDPOINT_SECRET!);
  } catch {
    // Wrong signature, or a delivery older than the replay window.
    return new Response('invalid signature', { status: 401 });
  }

  if (!isMailpistonEvent(event)) {
    return new Response('unrecognised payload', { status: 400 });
  }

  console.log(event.data.subject, event.data.from.email);

  // Answer quickly. A delivery that times out is retried, and your handler
  // will see the same event id again — key your own work off `event.id`.
  return new Response('ok');
}
```

`verifyWebhook` reads the request body itself and returns the parsed payload,
because the signature covers the exact bytes that arrived. Reading and
re-serializing the JSON first changes key order and number formatting, and the
signature will not match.

## Headers on every delivery

```text
X-Mailpiston-Event: email.received
X-Mailpiston-Delivery-Id: dlv_...
X-Mailpiston-Timestamp: 1788541200
X-Mailpiston-Signature: sha256=...
```

The signature is an HMAC-SHA256 over `timestamp + "." + body`. The timestamp is
covered on purpose: a signature over the body alone would stay valid forever,
so a captured delivery could be replayed at any point in the future.

## Sending

```ts
import { MailpistonClient } from '@mailpiston/sdk';

const mailpiston = new MailpistonClient({
  baseUrl: 'https://mailpiston.com',
  apiKey: process.env.MAILPISTON_API_KEY!,
});

const sent = await mailpiston.send({
  addressId: 'addr_...',
  to: ['customer@example.com'],
  subject: 'Thanks for writing in',
  text: 'We are on it.',
});

await mailpiston.reply(sent.id, { text: 'One more thing…' });
```

Use `reply` rather than composing a follow-up with `send`: MailPiston owns the
threading headers, and a reply assembled by hand arrives as a new conversation
in the recipient's mail client.

## The payload is a contract

`version` is `"1"` and stays `"1"` unless the shape breaks. New optional fields
can appear at any time, which is why `isMailpistonEvent` checks the envelope
and not every leaf — a guard that rejected unknown fields would turn an
additive change into an outage.

Never in the payload: inline attachment bytes, raw MIME, provider session
objects, reply-relay tokens, or the personal mailboxes a message may also have
been forwarded to. Attachments arrive as metadata plus an authenticated
`downloadUrl` that you fetch with your own API key.

`data.html` is untrusted input written by whoever sent the mail. Sanitize it
before rendering it anywhere.
