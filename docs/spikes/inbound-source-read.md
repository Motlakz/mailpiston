# Inbound Source-Read Spike

Date: 2026-09-05  
Inbound checkout: `C:\Users\User\inbound` at `eee305a`  
Scope: public API contracts, endpoints/routing, delivery state, threading, replies, mailbox views, and
the TypeScript SDK boundary. AWS/SES transport internals were intentionally excluded.

## Result

The clone is useful prior art, but not a foundation to fork. MailPiston should adopt Inbound's
developer ergonomics and several reliability patterns, adapt its endpoint model to support fan-out,
and reject transport-specific storage and privacy behavior.

The checked-out `packages/inbound-typescript-sdk` path is an unpopulated gitlink and the checkout has
no matching `.gitmodules` entry. The active API schemas and `stainless.yml` still expose the SDK
surface well enough for this decision. Do not copy SDK source until the exact upstream revision and
its Apache-2.0 generated-SDK license are pinned; the main Inbound application is MIT, but
`stainless.yml` declares the generated SDK as Apache-2.0.

## Adopt, adapt, reject

| Inbound pattern | Decision for MailPiston | Reason |
| --- | --- | --- |
| `send`, `reply`, list, retrieve, and thread-oriented API | **Adopt** | Small, unsurprising surface that matches the product |
| Reply by email id or thread id | **Adopt** | Convenient for dashboard and SDK users; a thread reply resolves its latest eligible message |
| `Idempotency-Key` on sends/replies | **Adopt** | Prevents duplicate customer mail after client retries |
| Threading from `In-Reply-To` and `References` only | **Adopt** | Avoids false merges caused by repeated subjects |
| Explicit envelope recipient independent of `To:` | **Adopt** | Required for BCC and catch-all deliveries |
| One endpoint abstraction with webhook, email, and email-group types | **Adapt** | Good user-facing model; implement typed relational configuration and verification rather than opaque JSON |
| One endpoint per address | **Reject** | MailPiston needs one address to fan out to several application and human destinations |
| Pre-create/claim a delivery row before an external side effect | **Adopt** | A unique claim plus compare-and-set state prevents concurrent duplicate delivery |
| Five-minute stale `processing` claim | **Adapt** | Keep leases reclaimable, but store an explicit `leaseExpiresAt` and owner id rather than infer it from `updatedAt` |
| Endpoint test action and delivery history | **Adopt** | Essential setup feedback and operations visibility |
| Reconstructed personal forward with attachments and context | **Adapt** | Constructed notifications are correct, but their `Reply-To` must be MailPiston's opaque relay address |
| `Reply-To` set directly to the original sender | **Reject** | A personal-mailbox reply would bypass MailPiston and expose the operator's address |
| Static verification token sent on every webhook | **Reject** | Use timestamped HMAC signatures with a replay window |
| Plaintext webhook secret inside JSON config | **Reject** | Signing secrets must be encrypted/derivable at rest because the server needs them to sign; a hash alone cannot sign |
| URL syntax/private-literal checks only | **Adapt** | Require HTTPS and validate DNS results at delivery time to resist DNS rebinding and private-address resolution |
| Separate inbound and sent-email tables | **Reject** | A single `emails` table with direction/status makes threads, search, and timelines simpler |
| Attachment content serialized with message rows | **Reject** | Keep metadata in Neon and bytes/raw MIME in R2 |
| Large payload containing both parsed and cleaned forms | **Adapt** | Publish a smaller provider-independent v1 payload, with explicit envelope data and attachment metadata/URLs |
| SDK runtime payload guard | **Adopt the capability** | Ship MailPiston-owned types, a validator, and signature verifier; do not depend on Inbound's package |

## Endpoint decision

`Endpoint` is the public umbrella term for any destination:

- `webhook`: an HTTPS application destination with an encrypted signing secret;
- `email`: one verified mailbox using privacy-safe reply relay by default;
- `email_group`: several independently verified recipients, each with its own relay authorization.

Use `address_endpoints` as a many-to-many join. This allows any address on any managed domain to have
zero or more endpoints of any combination, and lets one endpoint serve several managed addresses.
Keep subtype configuration in typed tables (`endpoint_webhook_configs` and
`endpoint_email_recipients`) rather than unvalidated JSON.

All endpoint deliveries begin only after durable inbound persistence. Failures never turn a provider
ingress acknowledgement into an error. Delivery uniqueness is based on `(event_id, endpoint_id)`, not
just `(email_id, endpoint_id)`, because one email can emit several public events.

## Private personal-mailbox reply decision

Inbound demonstrates the value of a constructed notification, but its current forwarder uses the
original customer as `Reply-To`. MailPiston must instead use:

```text
From: "Customer via managed-address" <managed-address@managed-domain>
To: verified-operator@example.net
Reply-To: reply+<opaque-token>@reply.mailpiston.app
```

The relay binds the token to the endpoint recipient, managed address, and thread. On reply,
MailPiston verifies both token and envelope sender, extracts the new content, creates fresh
customer-facing MIME and RFC threading headers, persists the outbound message, and sends it through
Forward Email. Personal transport headers, personal `Message-ID`, relay token, and destination
address never enter public webhook events or customer-facing mail.

This is generic configuration for every managed domain. No product domain or local part is encoded
in the implementation.

## Thread and mailbox decision

- Resolve threads only through normalized `Message-ID`, `In-Reply-To`, and `References` values.
- Search both inbound and outbound messages through one table and one indexed message-id namespace.
- Generate a customer-facing `Message-ID` before sending so persistence and provider output use the
  same id.
- Allocate any thread sequence atomically; do not use a read-then-increment counter.
- Expose a unified chronological thread containing inbound and outbound messages, direction, read
  state, attachments, and delivery status.
- Use cursor pagination for mail, threads, and event/delivery logs.
- Treat the envelope recipient as routing authority and retain header recipients separately.

## Webhook contract decision

Do **not** adopt Inbound's payload verbatim. Preserve its good ergonomics while publishing a smaller,
versioned MailPiston contract containing:

- `version`, event id/type/time, and delivery id;
- normalized message/thread ids and direction;
- envelope sender/recipients separate from header `from`/`to`/`cc`/`bcc`;
- subject and safe text/HTML representations;
- attachment metadata plus authenticated download URLs, not inline bytes;
- customer-facing outbound state for send/reply events.

The SDK should provide `verifyWebhook(request, secret)`, schema-derived TypeScript types, and a runtime
guard. Sign `timestamp + "." + exactRawBody`; enforce a timestamp tolerance and constant-time compare.

## Initial implementation consequences

Before Phase 1 schema work:

1. Update the domain model to typed endpoints and a many-to-many `address_endpoints` join.
2. Store webhook signing material as encrypted ciphertext (or derive it from a master key), never as
   hash-only material.
3. Keep the existing `ReplyRelay`, but bind it to an `endpoint_email_recipient_id`.
4. Keep one `emails` table for both directions and an event-scoped endpoint-delivery table.
5. Add test fixtures for BCC routing, duplicate ingress, concurrent delivery claims, header-only
   threading, wrong relay sender, revoked relay, and sanitized customer-visible MIME.
6. Complete Forward Email spikes 0.1-0.10 and 0.12 before treating provider details as settled.

## Files inspected

- `AGENTS.md`
- `stainless.yml`
- `LICENSE`
- `lib/db/schema.ts`
- `lib/types/inbound-webhooks.ts`
- `lib/email-management/email-router.ts`
- `lib/email-management/email-forwarder.ts`
- `lib/email-management/email-threader.ts`
- `lib/email-management/inbound-dedupe.ts`
- `app/api/e2/endpoints/*`
- `app/api/e2/emails/*`
- `app/api/e2/mail/*`

