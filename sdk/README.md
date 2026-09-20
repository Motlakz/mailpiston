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

## Migrating an app off a bundled email SDK

`sdk/.env.example` lists the environment an app needs, with the variables it
replaces named alongside. The short version, for a typical Inbound.new app:

| Was | Becomes |
| --- | --- |
| `INBOUND_API_KEY` | `MAILPISTON_API_KEY`, plus `MAILPISTON_API_URL` |
| `INBOUND_FROM_EMAIL` | `MAILPISTON_ADDRESS_ID` |
| `INBOUND_SENDING_DOMAIN` | nothing — the domain is the address's domain |
| `INBOUND_REPLY_TO` | nothing — replies return to the sending address |
| `INBOUND_WEBHOOK_TOKEN` | `MAILPISTON_ENDPOINT_SECRET` |

Two differences are worth knowing before you start, because they are the only
places the port is not mechanical.

**You send as an address id, not a `from` string.** Sending as an address
requires a concrete provider alias that authorises it, and a string cannot carry
that fact. So a wrong value is a 404 at send time rather than mail that quietly
fails SPF a week later. The id is on the Addresses page, on any address marked
*Concrete alias · can send*.

**The webhook is signed, not tokenised.** A shared token in a header stays valid
forever and is equally valid replayed. Deliveries here carry an HMAC over
`timestamp + "." + body`, so `verifyWebhook` can reject anything outside the
replay window. Replace the token comparison entirely — do not keep it as a
fallback, because a fallback that accepts a bare token is the whole of the
weakness you are removing.

Everything else — subject, text, html, to, cc — maps across unchanged.

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
