# Phase status

Companion to [`PROJECT_ROADMAP.md`](./PROJECT_ROADMAP.md). What is built, what is
deliberately deferred, and what still needs a live domain before it can be
called done.

Last updated: 2026-09-06.

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
- **Endpoint fan-out to webhooks.** `email.received` reaches email endpoints
  (Phase 6); HTTP endpoints are Phase 7.
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

- **Webhook endpoints.** The subtype is refused by `EndpointService.create`
  rather than half-built: an endpoint that accepts a URL and never delivers is
  worse than one that says "not yet". Phase 7.
- **Attachments on outbound.** Send and reply carry text and HTML only.
- **Reply-all.** The relay answers the original external sender, per §19.3.
- **The relay domain itself.** `RELAY_DOMAIN` must be a domain whose DNS we
  control, with a catch-all pointed at this deployment. Unset, notifications go
  out with no `Reply-To` and a reply lands back on the managed address.

---

## Not started

Phases 7–11 as written in the roadmap.
