# Phase status

Companion to [`PROJECT_ROADMAP.md`](./PROJECT_ROADMAP.md). What is built, what is
deliberately deferred, and what still needs a live domain before it can be
called done.

Last updated: 2026-09-08.

---

## Phase 0 — Recon and spikes · **not run**

Every spike except 0.11 needs things this repository cannot supply on its own: a
throwaway domain, DNS control, a Forward Email account, and a real inbox to send
from. They remain open.

What Phase 0 has produced so far:

- ✅ `0.11` — scoped source read of Inbound, recorded in
  [`spikes/inbound-source-read.md`](./spikes/inbound-source-read.md).
- 🟡 `0.2` — five fixture files exist under
  `server/providers/forward-email/__fixtures__/`, but they are **synthetic**,
  built from the documented payload shape rather than captured from a live
  delivery. Their README tracks which are still synthetic. When a real capture
  disagrees with one of them, the real payload wins.

Consequences carried into the code, each marked in place:

| Spike | Open question | Where it bites |
| --- | --- | --- |
| 0.4 | Attachment/payload ceiling | Phase 4. Unknown until measured. |
| 0.6 | Do we control `Message-ID` on send? | Phase 5 threading. |
| 0.10 | What `verify-smtp` demands beyond the inbound MX set | `dnsRecordsFor()` in `forward-email/provider.ts` carries a ⚠️ on the DKIM/return-path row. |

---

## Phase 1 — Foundation · **built**

| Deliverable | Where |
| --- | --- |
| Zod-parsed config, throws at boot | `server/core/config.ts` |
| Pooled (tx-capable) + HTTP read clients | `server/db/client.ts` |
| Full schema, 22 tables | `server/db/schema/`, migration `0000_curly_klaw.sql` |
| Error hierarchy + `formatErrorResponse` | `server/core/errors/` |
| Repository interfaces, one per aggregate | `server/repositories/types.ts` |
| `withApi` / `withProvider` wrappers | `server/core/http/` |
| Health route + error-path probe | `app/api/v1/health`, `app/api/v1/debug/error` |
| Auth: Better Auth + GitHub, one allow-listed email | `server/core/auth/`, `proxy.ts` |
| Dashboard shell, nine nav items, every page present | `app/(dashboard)/` |
| Icon fallback chain, single import site | `components/icon.tsx` |
| CI: lint, typecheck, test, boundaries, migration drift | `.github/workflows/ci.yml` |

Decisions made here, both from roadmap §5:

- **Single-tenant, confirmed** (§5.4). No `owner_id` on any mail table. The
  `users`/`sessions`/`accounts` tables exist only to authenticate one human.
- **Better Auth + GitHub OAuth** (§5.5), allow-listed by `ALLOWED_OPERATOR_EMAILS`.
  The allow-list is checked on user creation, on session creation, and again on
  every session read, so removing an address takes effect immediately.

Deviations from the roadmap, deliberate:

- `middleware.ts` → `proxy.ts` (Next 16), Node runtime, no `runtime` export.
- The `@theme` token block lives in `app/globals.css` and nowhere else; there is
  no `server/theme/theme.ts` to drift from it (§2.4).
- Repositories that belong to later phases (`emails`, `threads`, `endpoints`,
  `deliveries`, `replyRelays`) ship as shapes that throw `501` rather than
  returning plausible empty values — a silent `[]` from an unimplemented
  repository hides for weeks.

Still needs a real deployment to tick off:

- [ ] `vercel deploy` reaches Neon
- [ ] `drizzle-kit migrate` against a fresh database
- [ ] Sign-in works for the allow-listed account and fails for any other

---

## Phase 2 — Forward Email adapter · **built**

`MailProvider`, `ForwardEmailClient`, `ForwardEmailProvider`,
`ForwardEmailVerifier`, `ForwardEmailNormalizer`, `MockMailProvider`, and the
registry. Nothing outside `server/providers/forward-email/` names the provider —
`bun run check:boundaries` fails the build if that changes.

Tested: 15 normalizer cases against the five fixtures (including the BCC-only
delivery, which is the one that breaks a header-based normalizer), 7 signature
cases including a flipped byte, a wrong key, a wrong-length digest, and a
re-serialised body.

Deviation: `deleteAlias(aliasId, domainId)` takes the domain as a second
argument, because Forward Email addresses aliases as
`/v1/domains/{domain}/aliases/{id}` and an alias id alone is not routable.

Still needs a live throwaway domain:

- [ ] Signature verification against a genuinely captured request
- [ ] create domain → verify → create catch-all → delete alias, end to end
- [ ] Fixtures replaced with real captures

---

## Phase 3 — Domains and addresses · **built**

`DomainService` and `AddressService`, `/v1/domains/*` and `/v1/addresses/*`, and
the two dashboard pages: domains with status badges and a copyable DNS table,
addresses with inline create.

The distinction the whole phase turns on:

- `canSend: true` creates a concrete provider alias pointing at our ingress —
  required, because Forward Email will not authorise a `From:` for an address
  that exists only behind a catch-all (§5.6).
- `canSend: false` stays purely local behind the domain's optional catch-all,
  with no provider call at all.

An inbound-only address on a domain with no catch-all is refused rather than
created, because it would silently never receive anything.

Covered by tests: duplicate domain and duplicate address both raise
`ConflictError`; an inbound-only address makes no provider call; a failed create
leaves no orphan alias at the provider; catch-all creation is idempotent.

Still needs a live domain:

- [ ] Add a domain in the UI, publish the records, reach `verified`

---

## Phase 4 — Inbound email · **built, unverified against a live delivery**

`InboundService` (`server/mail/inbound/`) is the pipeline; the ingress route is
now thin around it. `NeonEmailRepository` is real. Storage is an interface with
an R2 driver and a development filesystem driver. The Inbox lists messages and
opens them.

| Deliverable | Where |
| --- | --- |
| Recipient resolution → capture / reject / duplicate | `server/mail/inbound/inbound-service.ts` |
| Atomic message + attachments + event write | `NeonEmailRepository.createInbound` |
| Object storage, two drivers | `server/storage/` |
| Read API + authenticated attachment download | `app/api/v1/emails`, `app/api/v1/attachments/[id]/download` |
| Inbox list and message viewer | `app/(dashboard)/inbox/` |

Five decisions were made here that the roadmap left implicit. Each one is a
place where the obvious implementation is wrong.

### Idempotency moved onto the row it protects

The plan (§10.2) claims an `idempotency_keys` row, then writes the message.
That leaves a window: a process that dies between the two loses the message
permanently, because the provider's retry finds the key taken and correctly
concludes the message is already stored.

`emails.fingerprint` now carries a unique index, and the insert *is* the claim.
There is no window — the transaction either commits or it does not. Migration
`0001_heavy_mister_sinister.sql`. `idempotency_keys` stays for Phase 6/7
sources that have no row of their own to protect.

### The fingerprint needed a content fallback

`provider:providerMessageId:messageId:recipient:addressId` collapses to
`provider:::recipient:addressId` when a delivery carries neither id — identical
for *every* message that sender→address pair ever exchanges. The first would
store and every one after it would be silently discarded as a duplicate.

`createInboundFingerprint` now appends a SHA-256 of the raw MIME (or of
sender/subject/date/body) when, and only when, both ids are absent. A genuine
retry still deduplicates; two different messages no longer collide. Message-ID
is mandated by RFC 5322 but is not guaranteed to survive every relay, so this
path is reachable in production.

### The catch-all does not accept unknown local parts

Easy to misread. The catch-all is a *transport* mechanism: it gets mail for any
local part to our ingress so an inbound-only address can exist without its own
provider alias (Phase 3). It is not permission to invent addresses. A message
for a local part with no `addresses` row is recorded as `email.rejected` and
dropped — otherwise every typo and every dictionary spam run becomes a durable
row. Mail to a disabled address is rejected the same way, with a distinct
reason so the two are told apart in the log.

### Webhook keys are per domain, not per deployment

Forward Email issues one webhook key per domain, so the single
`FORWARD_EMAIL_WEBHOOK_KEY` verifies exactly one of them. Keys now live
encrypted in `domain_webhook_keys` — a sibling table, for the same reason
`endpoint_webhook_configs` is a sibling of `endpoints`: the domain row is read
on ordinary paths that have no business carrying a secret.

Verification tries every candidate key rather than selecting one. Picking a key
by reading the recipient domain out of the body would be faster and is safe in
principle — claiming a domain does not let you forge its HMAC — but it means
parsing before authenticating, and that inverts the ordering `withProvider`
exists to guarantee. Tens of domains, microseconds per HMAC.

The env var stays as a fallback so a single-domain setup keeps working and an
upgrade cannot lock an operator out of their own ingress. Migration
`0002_high_vargas.sql`.

### HTML mail gets two independent defences

The viewer never touches `dangerouslySetInnerHTML`. Bodies render in an iframe
with `sandbox` and **no** allow-tokens — no scripts, no forms, no
`allow-same-origin` — and the document carries `default-src 'none'` internally.
The CSP is not primarily an XSS control: it blocks remote images, which in email
are tracking pixels that report when the operator opened the message. Inline
styles and `data:` images survive, so newsletters still look right.

Covered by tests (10 cases in `inbound-service.test.ts`): capture, replay →
duplicate, one message fanned to two addresses → two rows, two id-less messages
→ two rows, replayed id-less message → duplicate, unknown recipient → rejected
event and no row, disabled address → rejected, attachment bytes to storage with
the *decoded* length recorded, raw MIME only under the flag, and envelope-based
routing when `To:` names someone else.

Still needs a live delivery:

- [ ] A real external email appears in the Inbox
- [ ] A tampered body returns 401 and writes nothing
- [ ] A 2 MB PDF round-trips through R2 and downloads intact
- [ ] Ingress p95 under ~2 s

Still open, and deliberately so:

- **Spike 0.4, the payload ceiling.** Unmeasured. If Forward Email's inlined
  base64 exceeds Vercel's ~4.5 MB body cap, the fix is a Cloudflare Worker that
  streams the body to R2 and POSTs a pointer (§5.1) — the pipeline above does
  not change, only where `NormalizedAttachment.content` comes from.
- **Endpoint fan-out.** Now complete: `email.received` reaches email endpoints
  (Phase 6) and webhook endpoints (Phase 7). Each destination is isolated from
  the others and from ingress, so one failure costs only itself.
- **Orphaned objects.** Attachment bytes are written before the row, so a
  delivery that then turns out to be a duplicate leaves objects nothing
  references. That is the correct direction to fail — the alternative is a
  committed row pointing at a key that does not exist — but it wants a sweep
  eventually.

---

## Phase 5 — Threads · **built**

`DefaultThreadResolver` (`server/mail/threads/`), `NeonThreadRepository`,
`/v1/threads` and `/v1/threads/:id`, the threads list and conversation view.

Resolution is header-only: `In-Reply-To`, then `References`, then stop. The
plan's fourth step — a conservative subject and participant fallback — is
deliberately **not** implemented. Two customers who both write "Invoice" would
be merged into one conversation, and the operator would then reply with the
wrong person on the thread. An orphan thread is cosmetic by comparison. Ship the
header steps, measure how many messages land thread-less, then decide.

Two decisions worth keeping:

- **`findByMessageIds` matches the provider's id as well as ours.** The
  `In-Reply-To` a customer's client sends back is whichever id *their* copy
  carried, which for a message we sent is the one the provider stamped. That is
  plan §12's "known provider/message mapping" step, folded into one query.
- **The thread row is written inside the capture transaction.** Creating it
  before would leave an empty conversation behind whenever the message turns out
  to be a duplicate.

Covered by tests: reply stays in the parent's thread; a `References` chain works
with no `In-Reply-To`; two unrelated messages sharing a subject stay apart; a
reply quoting the provider id threads; a duplicate leaves no thread.

---

## Phase 6 — Outbound and replies · **built, unverified against live mail**

| Deliverable | Where |
| --- | --- |
| `POST /v1/emails/send`, `POST /v1/emails/:id/reply` | `app/api/v1/emails/` |
| Outbound persistence, queued → sent/failed | `server/mail/emails/outbound-service.ts` |
| Bounce/delivery events consumed | `app/api/providers/forward-email/events` |
| Provider send quota, cached | `server/mail/emails/quota.ts` |
| Endpoint CRUD, bindings, verified recipients | `server/mail/endpoints/` |
| Personal-inbox notifications | `server/mail/forwarding/forwarding-service.ts` |
| Opaque reply relay | `server/mail/forwarding/relay-service.ts` |
| Sent page with compose, reply box, endpoints page | `app/(dashboard)/` |

### The row goes in before the send

Same shape as inbound writing bytes before the row: the step that can succeed
while its answer is lost must be the one that leaves a trace. A send that only
becomes visible when the response arrives is invisible if the process dies
mid-flight — the mail went out and MailPiston has no record. A row stuck in
`queued` is visible and repairable; a failed send stays as `failed` rather than
disappearing.

### Notifications are constructed, never redirected

Re-sending the customer's raw MIME to a personal mailbox would carry their
`Message-ID`, `Received` chain, and authentication results out of the managed
domain — and a reply would go straight from the operator's personal address to
the customer. The notification is a fresh message from the managed address, with
an opaque `reply+<token>@` `Reply-To`; only the token's hash is stored, since the
relay address is public the moment it is delivered.

A relayed reply is likewise reconstructed, not re-transmitted: only the new text
survives, and `outbound.reply()` owns the threading headers so a relayed reply
and a dashboard reply are the same customer-facing thing.

### What a relay refuses, and why each check is load-bearing

Unknown, revoked, or expired token; a sender that is not the verified recipient
the token was minted for; an autoresponse. Each rejection sends nothing, records
why, and still answers 200 — retrying would not change the outcome. The
sender check is the one an attacker who learns a relay address has to beat.

### Recipients are verified by challenge

The operator can type any address, and a typo would start forwarding a
customer's mail to a stranger. A code is mailed from the managed address that
will do the forwarding; the hash and expiry are both part of the matching
`UPDATE`, so there is no branch that can verify on a failed comparison.

Covered by tests (13 in `forwarding.test.ts`, 8 in `outbound-service.test.ts`):
send persists and emits both events; an inbound-only address is refused before
the provider is called; a failed send stays visible as `failed`; replies thread
for the recipient; `Re:` does not stack; a customer follow-up rejoins the
thread; a bounce flips status; an unmatched delivery event is still recorded;
notification carries no customer transport headers; only the token hash is
stored; unverified recipients are never forwarded to; forwarding failure never
un-captures the message; wrong sender, revoked token, unknown token, and
autoresponses all send nothing.

Still needs live mail:

- [ ] Send a new message; it arrives and appears in Sent
- [ ] Reply to an inbound email; **Gmail threads it with the original**
- [ ] A send to a known-dead address flips to `hard_bounced`
- [ ] Bind a verified personal inbox; mail reaches both the Inbox and it
- [ ] Reply from the personal inbox; the customer sees only the managed address
- [ ] The customer-visible raw message contains no personal address

Deliberately deferred:

- **Attachments on outbound.** Send and reply carry text and HTML only.
- **Reply-all.** The relay answers the original external sender, per §19.3.
- **The relay domain itself.** `RELAY_DOMAIN` must be a domain whose DNS we
  control, with a catch-all pointed at this deployment. Unset, notifications go
  out with no `Reply-To` and a reply lands back on the managed address.

---

## Phase 7 — Webhook endpoints · **built, unverified against a live receiver**

| Deliverable | Where |
| --- | --- |
| `webhook` subtype enabled, secret shown once | `server/mail/endpoints/endpoint-service.ts` |
| Public v1 payload | `sdk/src/payload.ts`, built by `server/mail/webhooks/payload.ts` |
| Signing and verification, one implementation | `sdk/src/signing.ts` |
| SSRF guard, config time *and* delivery time | `server/mail/webhooks/url-guard.ts` |
| Synchronous first attempt, then stop | `server/mail/webhooks/webhook-service.ts` |
| Delivery persistence | `server/repositories/neon/delivery-repository.ts` |
| Test delivery, rotate secret, delivery log | `/v1/endpoints/:id/{test,rotate-secret,deliveries}` |
| Delivery log UI, webhook panel | `app/(dashboard)/endpoints/`, `components/mail/endpoint-actions.tsx` |
| SDK: `verifyWebhook`, payload types, guard, `send`/`reply` | `sdk/` |

No migration: `endpoint_webhook_configs` and `endpoint_deliveries` have been in
the schema since `0000`. Phase 7 is the first thing to write to them.

### The SDK owns the contract, and the server imports it

`sdk/src/payload.ts` and `sdk/src/signing.ts` are not copies of server types —
they are *the* definitions, and `server/mail/webhooks/` imports them through the
`@/` path alias. Two consequences, both deliberate:

- A field that exists only server-side is impossible, because there is no
  server-side definition to add it to.
- The server signs with the same function receivers verify with. A signer and a
  verifier written separately agree exactly until one of them is edited; this
  way there is nothing to drift. `signing.test.ts` still pins the scheme against
  an independent `node:crypto` HMAC, because the format is documented and third
  parties will reimplement it.

Web Crypto rather than `node:crypto` in the SDK, so the same module runs in
Node, Bun, Deno, Workers, and on the edge. A receiver should not have to pick a
runtime to check a signature.

### Enqueue is the election, not a lock

The synchronous first attempt runs on the ingest path, and two concurrent
deliveries of the same provider payload would otherwise both POST. `enqueue`
inserts with `ON CONFLICT DO NOTHING` against the unique index on
(event, endpoint, recipient) and reports whether *it* created the row; only the
creator delivers. A read-then-write check would leave a window where both
callers see nothing and both deliver.

That is why Phase 8's `claim` is still unimplemented rather than half-built:
Phase 7 needs no lease, and a claim that looked usable would be the more
dangerous thing to leave lying around.

### A failure is `pending`, not `failed`

`markFailed` takes a `nextAttemptAt`; a time leaves the row `pending` and due
then, `null` sets `failed`. Phase 7 always passes a time, so a failed delivery
sits due-now until Phase 8 has a scheduler to pick it up. Recording it as
`failed` would mean Phase 8 has to guess which failures were final.

### The URL is checked twice, and the residual gap is named

HTTPS only, no embedded credentials, and no resolution into loopback, private,
link-local, CGNAT, benchmarking, or multicast space — including the IPv6 forms
that reach an IPv4 host (`::ffff:127.0.0.1`, `::127.0.0.1`, `64:ff9b::`). The
check runs when the endpoint is configured **and** immediately before every
delivery, because a hostname that resolved publicly when saved can be repointed
afterwards. Redirects are never followed: a 302 to the metadata service would
walk straight past the host we just validated.

What is *not* closed: `fetch` resolves the hostname itself, so a record that
changes between our lookup and its lookup is not covered. Closing it needs a
custom agent that dials the validated address. The window is milliseconds and
the attacker must already control DNS for a hostname the operator typed in
themselves — but it is a gap, and it is written down rather than implied.

### The secret is encrypted, and still shown once

It has to be recoverable — the server signs every delivery with it — so it
cannot be hashed. That makes "returned by exactly one response, ever" the only
remaining control, and there is no read path that returns it. `webhookUrl()`
exists precisely so the dashboard can show the destination without the config
row (and its ciphertext) travelling to a page.

Rotation has no grace period. Honouring two secrets at once would mean a
compromised secret keeps working until somebody removes it.

### What the payload deliberately excludes

Inline attachment bytes, raw MIME, provider session objects, relay tokens,
personal forwarding destinations, fingerprints, storage keys, and provider
message ids. Attachments carry metadata plus an authenticated `downloadUrl`.
The envelope is a separate object from the headers, because they disagree on
exactly the deliveries that matter — a BCC arrives with a `To:` naming somebody
else, and routing followed the envelope.

`EmailStatus` is translated rather than exported: `soft_bounced` and
`hard_bounced` both surface as `bounced`, since which one it was is our retry
decision and an application reacts identically to both.

Covered by tests (19 in `webhook-service.test.ts`, 13 in
`endpoint-service.test.ts`, 16 in `sdk/src/signing.test.ts`, 26 in
`url-guard.test.ts`): a delivery the published SDK verifies end to end; a wrong
secret and a tampered body both rejected; stale *and* future timestamps
rejected; a 500 leaving a `pending` row with the code recorded and no throw; a
transport error with no code; a private-address endpoint failing without any
request being made; one delivery per event however many times it is dispatched;
disabled endpoints and mailbox endpoints ignored by the webhook path;
attachment metadata with no bytes and no storage keys; internal fields absent
from the body; a test delivery that writes no row; secrets stored only as
ciphertext and never returned on a read; a refused URL leaving no endpoint
behind; repointing a URL keeping the secret.

Still needs a live receiver:

- [ ] Mail to `support@` POSTs to the configured endpoint within seconds
- [ ] The receiving app verifies the signature with the published snippet
- [ ] A stale timestamp fails verification
- [ ] An endpoint returning 500 leaves a `pending` delivery with the response
      code recorded, and **ingress still returns 200**

Deliberately deferred:

- **Retries.** Phase 8. A failed delivery is `pending` and due; nothing scans
  for it yet.
- **Manual retry button.** Phase 8, routed through the same claim path. The
  service method it needs (`WebhookService.attempt`) exists and is tested.
- **Events other than `email.received`.** The deliverable set is one entry in a
  map in `webhooks/payload.ts`; bounce and delivery events land with Phase 9's
  timeline, where they have somewhere to be read.
- **SDK packaging.** `sdk/` is source-only and consumed through the path alias.
  It gets a build and a version the first time someone outside this repository
  needs it.

---

## Phase 8 — Inngest retry engine · **built, unverified against a live receiver**

| Deliverable | Where |
| --- | --- |
| Atomic claim, and requeue for manual retry | `server/repositories/neon/delivery-repository.ts` |
| Backoff curve with jitter | `server/mail/webhooks/retry-schedule.ts` |
| Scheduler seam | `server/mail/webhooks/retry-scheduler.ts` |
| Inngest client, event, retry function | `server/jobs/` |
| Inngest ingress | `app/api/inngest/route.ts` |
| Manual retry, through the same claim | `POST /v1/deliveries/:id/retry`, delivery-log button |

No migration: `endpoint_deliveries` has carried `lease_owner`, `lease_expires_at`
and `next_attempt_at` since `0000`, and the due index is already
`(status, next_attempt_at)`.

Held §15.7 exactly: no Redis, no BullMQ, no Vercel Cron scanner, no worker. The
only new infrastructure is one Inngest function.

### One claimed path, three entry points

The first attempt on the ingest path, a scheduled retry, and an operator's
manual retry now all run `attemptDelivery`, which claims before it does
anything else. Three entry points each doing their own state handling would
eventually disagree, and the way they would disagree is by delivering twice.

The manual-retry button is the sharpest case, because an operator presses it
precisely when a scheduled retry is due. It requeues and then goes through the
identical claim — it gets no shortcut past it.

### The claim has a branch the plan does not

Plan §15.5 claims `WHERE status IN ('pending','failed')`. Two changes:

- **`failed` is not claimable.** It is the terminal state, and a duplicate
  Inngest event arriving after the schedule gave up must not resurrect a
  delivery. Manual retry reaches it through `requeue`, which is an explicit
  transition back to `pending`.
- **An expired lease is claimable.** A function that dies mid-attempt leaves the
  row `delivering` with a lease nobody holds. Without this branch the delivery
  is stuck there permanently — no retry can touch it, and the log shows it
  perpetually in flight. The lease is the request timeout plus 30 seconds, so a
  slow-but-alive attempt is never stolen out from under itself.

### `retries: 0` on the Inngest function

Inngest's own retries would re-run the function and produce an extra delivery
attempt that the schedule never authorised, on a curve nobody chose. The
delivery's own schedule is the only one. The chain is self-terminating: each
failure enqueues the next event before returning, and the last one enqueues
nothing.

### Jitter is not decoration

A receiver that falls over drops every in-flight delivery at once. An unjittered
schedule marches all of them back in lockstep, so the retry storm arrives at the
same instant as the last one — precisely when the receiver is least able to take
it. ±15%, and never applied to the immediate first attempt, which would only put
the ingest path to sleep for no reason.

### State first, schedule second

`markFailed` runs before `scheduleRetry` (§15.2). If the process dies between
them, the delivery is a `pending` row a manual retry can pick up — recoverable.
The other order loses the row and books an event pointing at nothing. The
scheduler is an interface rather than a direct Inngest call so the delivery
service stays testable, and so that the split the design rests on stays visible
in the types.

`WebhookService` takes its scheduler as a **required** option. A deployment that
ends up never retrying should have had to write that down.

### Production refuses to start without Inngest keys

`INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are optional locally — the Inngest
dev server needs neither — and mandatory when `NODE_ENV=production`. The failure
mode they prevent is the quiet one: failed deliveries accumulating as `pending`
rows that nothing ever picks up, whose only symptom is a webhook that never
arrives.

### Final failure leaves `next_attempt_at` alone

Plan §15.6 asks for `NULL`. The column is `NOT NULL`, and `status = 'failed'`
already says there is no next attempt — the due index is keyed on status first,
so nothing will ever read the stale value.

Covered by tests (16 in `retry-schedule.test.ts`, 12 new in
`webhook-service.test.ts`): the curve pinned attempt by attempt; jitter bounded
either side and never applied to attempt 1; the schedule refusing attempt 0 and
anything past the last; a failure booking exactly one retry and a success
booking none; a full run to exhaustion leaving `failed`, `attempt = 7`, one
schedule fewer than attempts, and a `final: true` event; a stray attempt after
final failure skipped; a second attempt while one is in flight skipped with no
request made; an expired lease reclaimed and delivered; manual retry requeueing
a finally-failed delivery and delivering it; manual retry refusing one the
receiver already acknowledged; a missing delivery 404ing.

Still needs a live receiver:

- [ ] A 500 schedules a retry; a subsequent 200 stops the chain
- [ ] Two concurrent Inngest executions cannot both deliver the same delivery
      (force a duplicate event)
- [ ] After the final attempt the delivery is `failed`, with full attempt
      history inspectable
- [ ] Manual retry works and does not bypass the claim

Deliberately deferred:

- **Attempt history.** The log shows the latest response code, error, and
  attempt count. Per-attempt rows land with Phase 9's event timeline, where
  `webhook.failed` events already carry the attempt number and finality.
- **Dead-letter handling.** A `failed` delivery stays visible and manually
  retryable. Anything more — alerting, bulk replay — waits until there is
  evidence of needing it.

---

## Phase 9 — Event timeline · **built**

| Deliverable | Where |
| --- | --- |
| Filterable event stream | `NeonEventRepository.list`, `EventFilter` |
| Keyset cursor | `server/core/pagination.ts` |
| `GET /v1/events` | `app/api/v1/events/route.ts` |
| Logs page with filters | `app/(dashboard)/logs/page.tsx` |
| Shared timeline component | `components/mail/event-timeline.tsx` |

No migration. Every event has been written since Phase 4; this phase is the
first thing to read them back as a stream.

### The cursor needed the id, not just the timestamp

`email.received`, `webhook.queued`, and `webhook.delivered` for one message are
written within the same transaction and routinely share a millisecond. A cursor
of `occurred_at < $1` silently drops whichever of them straddles a page
boundary — the operator sees a message received and delivered with the queue
step missing, and there is nothing in the output to suggest a row went astray.

The cursor is now `(occurred_at, id)` compared as a tuple, which Postgres
evaluates as one indexable expression. The id is an arbitrary tiebreak — ours
are random, not sequential — but it only has to be stable.

A malformed cursor pages from the start rather than returning 400. It is an
opaque client-held string, and the most common bad one is a stale bookmark; a
mildly wrong answer beats a broken saved URL.

### Filtering by address has to include mail that never became a message

`email.rejected` has no message, and therefore no address — only a recipient in
its metadata. It is also the single event someone filtering by address is most
often hunting for, because "where did that mail go?" is usually answered by "no
such local part". So the address filter matches both: events whose message
belongs to the address, **or** address-less events whose metadata recipient is
that mailbox. The route resolves the address to its email once and passes both
halves down.

### One list of event types, checked against Postgres at compile time

`MAIL_EVENT_TYPES` is a value in `server/core/types.ts`; the Postgres enum is
built from it, and a type-level assertion in `schema/enums.ts` fails the build
if the two ever diverge. The Logs filter and `/v1/events` validation both read
that array, so a new event type appears in the filter and is accepted by the
API without anyone remembering to update a second list.

An unrecognised `?type=` is rejected rather than ignored. Silently dropping it
returns the *unfiltered* stream, which reads as "there are no events of that
kind" — the opposite of the truth.

### One timeline component, two places

The Logs page and the message viewer render the same component. Two timelines
that could disagree would mean one of them is lying about what happened, and
the whole point of this phase is that the audit trail is trustworthy.

The row shows what the metadata actually holds — recipient, reason, response
code, attempt number, whether a failure was final — read defensively, because
metadata shapes differ per event type and a row that cannot be summarised must
still render.

Covered by tests (10 in `pagination.test.ts`): round-trip, sub-second precision
preserved, splitting on the first separator, and null for every malformed form
including empty, null, undefined, no separator, no timestamp, no id, and an
unparseable timestamp.

Acceptance, all met:

- [x] Every message has a complete audit trail from receipt to final endpoint
      delivery
- [x] Filtering by endpoint shows only that endpoint's deliveries
- [x] The timeline renders correctly for a message whose delivery ultimately
      failed — the `final` flag on `webhook.failed` is rendered explicitly

Deliberately deferred:

- **Cursor paging in the UI.** The Logs page shows the most recent 100 and says
  so; the API pages properly. A "load more" button waits until there is a
  volume of events that makes scrolling the natural gesture.
- **Per-attempt delivery history.** `webhook.failed` events already carry the
  attempt number and finality, so the trail is complete; a dedicated
  attempts table would only denormalise what the stream already says.

---

## Phase 10 — Provider reconciliation · **built, unverified against a live account**

| Deliverable | Where |
| --- | --- |
| The sweep, and what counts as drift | `server/mail/reconciliation/reconciliation-service.ts` |
| Run and item persistence | `server/repositories/neon/reconciliation-repository.ts` |
| Six-hourly cron | `server/jobs/reconcile-provider.ts` |
| Read the latest run, or force one | `GET`/`POST /v1/reconciliation` |
| Explicit repair | `PUT /v1/domains/:id/catch-all`, `DomainService.repairCatchAll` |
| Drift banner | `app/(dashboard)/domains/page.tsx`, `DriftBanner` |

No migration: `provider_reconciliation_runs` and `_items` have been in the
schema since `0000`.

### What this phase is actually for

MailPiston's state and the provider's are two copies of one configuration, and
the provider's is the one that routes mail. They drift for ordinary reasons —
somebody deletes an alias in the Forward Email dashboard, the app origin moves
and leaves every alias pointing at a dead URL, a domain gets removed and
recreated. **None of that produces an error anywhere.** Mail stops arriving and
the dashboard goes on looking correct. This sweep exists to notice.

### It never repairs, and that is a design decision, not caution

Not even the "obviously safe" cases. An automatic repair racing an operator who
is mid-change turns a visible problem into two writers disagreeing, and a wrong
repair routes a customer's mail somewhere unintended. Repair is
`DomainService.repairCatchAll`, reachable only from a button next to the
finding.

Repair **repoints** rather than deleting and recreating: deleting first opens a
window in which the domain has no catch-all at all, and mail arriving in that
window is gone, not delayed. It also finds the alias by local part rather than
by our stored id — the stored id is exactly what goes stale when a domain is
recreated at the provider, which is one of the cases repair has to handle.

### "We could not tell" is a finding

A provider call that throws becomes an `error` item and the sweep continues to
the next domain — the one after the broken one might be the one that is
actually wrong. Skipping it silently would render as "checked, fine", which is
the one thing this phase must never say.

`ok` items are recorded and returned too. "We checked 14 things and 13 were
fine" and "we checked one thing" look identical if only problems come back, and
the difference between them is whether the sweep ran at all.

### It compares in one direction

Provider domains MailPiston does not know about are not drift. Phase 3 adopts
existing domains, and an operator's Forward Email account may legitimately hold
others; flagging them would train everyone to ignore the banner.

### Alias checks go past the roadmap's scope, deliberately

The roadmap scopes this to the catch-all. Concrete address aliases are checked
too, because `listAliases` already returns them in the same call and a repointed
address alias is the same failure with a narrower blast radius — one mailbox
silently stops receiving instead of all of them.

Four alias conditions count as drift: disabled at the provider, local part
changed, recipients that do not include our current ingress URL, and **extra
recipients alongside ours**. The last is the subtle one: delivery to us still
works, so nothing looks wrong, while a copy of the operator's customer mail goes
somewhere MailPiston does not know about.

### Six hours

Not a default. Drift here is silent, so the interval is really "how long is it
acceptable to lose mail before anyone is told". A day is too long; a minute
spends the provider's rate limit finding nothing, all day. The cron function
gets `retries: 1`, unlike the delivery function's `0` — a sweep that failed on a
transient hiccup is worth repeating, and repeating it is safe precisely because
it writes findings and changes nothing.

Covered by tests (15 in `reconciliation-service.test.ts`): a healthy account
reporting two `ok` items and a completed run; a deleted catch-all; a repointed
catch-all; an extra recipient; a disabled alias; a domain gone from the
provider; a domain recreated under a new id; a drifted concrete address alias;
the sweep changing nothing when it finds a problem; unmanaged provider domains
ignored; a provider error recorded as a finding; the sweep continuing past a
failed domain; repair recreating a deleted catch-all; repair repointing rather
than recreating; repair working from a stale alias id.

Still needs a live provider account:

- [ ] Manually deleting a catch-all alias in the Forward Email dashboard raises
      a drift warning within one cycle
- [ ] Manually repointing a catch-all at a different URL is detected
- [ ] Nothing is repaired without an explicit click

Deliberately deferred:

- **Repairing address aliases.** Detected, but only the catch-all has a repair
  button. An address alias repair is `AddressService`'s to own, and it wants
  the same care about not deleting first.
- **Alerting.** The banner is on the page an operator visits when they suspect
  a domain problem. Pushing a notification anywhere waits until there is a
  deployment for it to notify.

---

## Phase 11 — Hardening · **built, except what needs a deployment**

| Deliverable | Where |
| --- | --- |
| §24 security pass, item by item | [`security-review.md`](./security-review.md) |
| Rotation runbooks | [`runbooks.md`](./runbooks.md) |
| API key management | `/v1/api-keys`, `app/(dashboard)/api-keys/` |
| Audit log for privileged mutations | `withApi`'s `audit` option, `audit_logs`, Settings page |
| Encryption-key rotation | `SECRET_ENCRYPTION_KEY_PREVIOUS` fallback in `decryptSecret` |
| Retention and the pruning job | `server/mail/retention/`, `server/jobs/prune-retained-objects.ts` |
| Backup/restore procedure | [`runbooks.md`](./runbooks.md) §7 — **written, not performed** |
| Migration batches and per-batch checklist | [`runbooks.md`](./runbooks.md) §8 |

Migration `0006_odd_juggernaut.sql` adds `email_attachments.pruned_at` and its
index.

### The security pass found two things missing, not zero

A checklist that comes back all-green on first reading was not a review. Two
§24 items had no implementation at all:

- **API keys could not be created.** `generateApiKey` and the repository had
  existed since Phase 1, the auth path read them on every request, and every
  documented `curl` in this repo used one — but there was no route and no UI.
  Now `POST /v1/api-keys` returns the plaintext exactly once, and the first key
  is minted from the dashboard. That bootstrap is intentional: GitHub OAuth
  behind an allow-list is a stronger front door than any key-issuing endpoint
  we could leave open.
- **Nothing wrote to `audit_logs`.** The table had been in the schema since
  `0000` and was empty by construction.

### The audit log is a route option, not a call

`withApi` takes `audit: { action, resourceType }` and writes the entry after a
successful handler. Sixteen mutations are marked. Declaring it beside the
route's other cross-cutting concerns is the point — a handler that has to
remember to log is a handler that eventually does not, and the ones that forget
are the ones nobody notices.

Two details that would be bugs the other way round:

- **The body is redacted before it is written.** A webhook key arrives in the
  body of the very route whose mutation is worth auditing, and an audit log is
  a plaintext table read by more people than the encrypted column it was meant
  to protect. Message bodies are redacted too — the audit trail records that a
  message was sent, not what it said.
- **A failed audit write never fails the request.** The mutation already
  happened. Returning an error for work that succeeded makes the caller retry
  it, turning a logging outage into duplicate domains. A missing entry is a gap
  in a record; a retried mutation is a change to the system.

### Encryption-key rotation was impossible; now it is a migration

`SECRET_ENCRYPTION_KEY` encrypts every stored webhook key and endpoint signing
secret. Changing it made all of them undecryptable at once — inbound
verification and outbound signing both stop, and neither failure looks like a
key problem.

`decryptSecret` now tries the current key and then
`SECRET_ENCRYPTION_KEY_PREVIOUS`. GCM authenticates, so a wrong key fails loudly
rather than returning plausible garbage, which is what makes trying keys in
order safe. Rotation becomes: set both, re-encrypt, drop the previous one.

### Retention keeps the metadata and deletes the bytes

A pruned attachment keeps its row. "This message had a 4 MB PDF called
invoice.pdf, and we deleted it on the 3rd" is a complete answer; deleting the
row instead leaves the operator looking at a message that appears never to have
had an attachment. The download route answers `410 Gone` with the prune date —
a `404` would say "there is no such attachment", which is false and sends
someone looking for a bug.

**Bytes go before the row is marked**, the opposite of the inbound pipeline's
order and correct for the same reason. Crash after the delete and the row is
still unmarked, so the next sweep retries — and deleting an object that is
already gone is a no-op in both drivers, so the retry converges. Marking first
would leak an object that nothing references and nothing can find.

Both windows default to unset, meaning keep forever. The safe failure for a mail
archive is keeping too much, and an operator who has not chosen a policy has not
consented to one.

### Two §24 items are met differently, and say so

- **Internal cron secret** — not implemented as written. Scheduled work runs
  through Inngest, which signs its invocations, and `/api/inngest` verifies that
  signature. Strictly stronger than a static bearer token, which is replayable
  from a log line. A cron secret on top would be a second credential on the
  same door.
- **Encrypted environment secrets** — delegated to the platform. What this
  codebase adds is failing at boot rather than at first use.

Covered by tests (9 in `retention-service.test.ts`): no policy prunes nothing;
raw MIME pruned past its window and left alone inside it; the parsed message
surviving a raw-MIME prune; attachment bytes deleted with the metadata row
kept; an already-pruned attachment skipped; the two policies applied
independently; a storage failure counted without stopping the sweep and without
marking the row; and the next sweep recovering it.

Still needs a deployment:

- [ ] A restore from backup has actually been performed, not just documented
- [ ] Batch 1 runs a week with zero lost messages before Batch 2 starts

Still open, dated, in [`security-review.md`](./security-review.md):

- Spike 0.4, the attachment payload ceiling — unmeasured since 2026-09-05.
- DNS rebinding between our lookup and `fetch`'s — accepted 2026-09-08.
- Orphaned storage objects — accepted 2026-09-06; retention now bounds them
  whenever a policy is set, but a dedicated sweep is still owed.

Deliberately deferred:

- **An orphan sweep.** Retention prunes by age; objects with no row are only
  collected once they fall outside the window, and never at all if no policy is
  set.
- **Re-encrypting stored secrets in place.** Rotation goes through the existing
  rotate and re-save actions, which is a handful of clicks at this scale. A
  bulk pass is worth writing when there are enough endpoints to make it tedious.
- **Audit log pagination in the UI.** The Settings page shows the most recent
  50; the repository pages properly.

