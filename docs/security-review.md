# Security review

The execution plan's §24 checklist, item by item, with where each one is
implemented and what is still owed. Companion to
[`phase-status.md`](./phase-status.md) and [`runbooks.md`](./runbooks.md).

Reviewed: 2026-09-08, against commit `fc29a93` plus the Phase 11 changes.

An item is **met** only if there is code enforcing it that a test or a CI check
would fail on. "It is documented" is not met. Where the plan asks for something
we do differently, the difference is written down rather than quietly ticked.

---

## Met

### Provider webhook signature verification

`server/providers/forward-email/verifier.ts`, composed by
`server/core/http/with-provider.ts`, which fixes the ordering: verify, then
parse. Nothing reads the body before it is authenticated.

Keys are per domain (`domain_webhook_keys`, encrypted), because Forward Email
issues one key per domain and a single env var verifies exactly one of them.
Every candidate key is tried rather than selecting one by reading the recipient
out of the body — selecting would mean parsing before authenticating.

Tested: 7 signature cases including a flipped byte, a wrong key, a wrong-length
digest, and a re-serialised body.

### API key hashing

`server/core/auth/api-key.ts`. SHA-256 of 24 bytes of CSPRNG output, looked up
by hash; the plaintext is returned by `POST /v1/api-keys` and never again.

SHA-256 rather than a password hash is deliberate: there is no low-entropy
guess to slow down, and the lookup runs on every API request. Revocation is a
timestamp checked on every request, so it takes effect immediately.

### Endpoint-secret encryption

AES-256-GCM in `server/core/crypto/index.ts`, ciphertext tagged `v1:` so the
format can change without guessing at stored rows. Encrypted rather than hashed
because the server must recover the secret to *sign* deliveries — which is
exactly why "returned by one response, ever" is the remaining control.

`decryptSecret` falls back to `SECRET_ENCRYPTION_KEY_PREVIOUS`, which is what
makes rotation a migration rather than an outage. See
[`runbooks.md`](./runbooks.md).

### HMAC downstream webhook signatures

`sdk/src/signing.ts`, used by both ends. The server signs with the same
function receivers verify with, so there is nothing to drift; a test pins the
scheme against an independent `node:crypto` HMAC because third parties will
reimplement it.

### Request timestamp tolerance

Signed over `timestamp + "." + body`, never the body alone — a signature over
the body alone stays valid forever. `verifyWebhook` rejects timestamps outside
±300s, in **both** directions: a far-future stamp would otherwise keep a
captured delivery replayable for as long as it is ahead of the clock.

### Idempotency

Two mechanisms, both constraint-based rather than check-then-act:

- **Inbound**: `emails.fingerprint` unique index. The insert *is* the claim, so
  there is no window in which a crash loses a message the provider will not
  re-send.
- **Delivery**: unique index on (event, endpoint, recipient) plus the atomic
  claim. `enqueue` elects one deliverer; `claim` re-elects on every retry.

### SQL parameterization

Drizzle throughout; nothing builds SQL by string concatenation. Raw `sql`
templates interpolate either column references (rendered as identifiers) or
values (bound as parameters) — audited, 20 sites, all clean.

### Rate limiting

`server/core/rate-limit/`, Neon-backed fixed windows via a transactional
`SELECT … FOR UPDATE`, never read-then-write. Per-endpoint configuration with an
explicit fail-open/fail-closed decision on every bucket: anything that spends
money, sends mail, or reaches a third-party URL fails closed; already
authenticated provider callbacks and reads fail open.

### Attachment access controls

`app/api/v1/attachments/[id]/download`. The caller authenticates first; the
bucket is private and a presigned URL is minted only afterwards, with a
five-minute life. Responses carry `default-src 'none'; sandbox` and
`nosniff`, because attachments arrive from strangers.

### Verified email endpoint recipients

Proof of control by challenge. The hash and the expiry are both part of the
matching `UPDATE`, so there is no branch that can verify on a failed
comparison, and wrong/expired/never-issued all return one message.

### Opaque, hashed, revocable reply-relay tokens

`reply_relays`. Only the token hash is stored — the relay address is public the
moment it is delivered — with an expiry and a revocation timestamp.

### Strict relay sender matching

`RelayService` refuses unknown, revoked, and expired tokens, senders that are
not the verified recipient the token was minted for, and autoresponses. Each
rejection sends nothing, records why, and still answers 200: retrying would not
change the outcome.

### Personal transport headers removed from reconstructed replies

Notifications and relayed replies are **constructed**, never re-transmitted.
Only the new text survives, and `outbound.reply()` owns the threading headers,
so a relayed reply and a dashboard reply are the same customer-facing thing.
Tested: the customer-visible message carries no personal address.

### Relay loop and auto-responder protection

Notifications carry `Auto-Submitted: auto-generated` and
`X-Mailpiston-Forward`; our own ingress drops anything wearing them, and
well-behaved autoresponders stay quiet.

### No provider credentials exposed to the browser

`scripts/check-boundaries.sh` fails CI if `components/` or `lib/` imports
anything from `@/server/` other than the types-only module, if `process.env` is
read outside `server/core/config.ts`, or if the provider is named outside its
adapter directory.

### Audit log for privileged mutations

`audit_logs`, written by `withApi` from a declared `audit` option rather than
by each handler — a handler that has to remember to log is one that eventually
does not. Sixteen mutations are marked. Entries record actor, action, resource,
and the request body with secret-bearing fields redacted first: an audit log is
a plaintext table read by more people than the encrypted column it was meant to
protect.

Writing the entry never fails the request. The mutation already happened, and
returning an error for work that succeeded makes the caller retry it — turning
a logging outage into duplicate domains.

---

## Met differently from the plan

### Internal cron secret

**Not implemented as written, and deliberately.** The plan assumes cron jobs
reached over an HTTP endpoint guarded by a shared secret. Our scheduled work
runs through Inngest, which signs its invocations; `/api/inngest` verifies that
signature with `INNGEST_SIGNING_KEY`, and production refuses to start without
it.

That is strictly stronger than a static bearer token: the signature covers the
request and cannot be replayed from a log line. A cron secret on top would be a
second credential protecting the same door.

### Encrypted environment secrets

Delegated to the platform — Vercel encrypts environment variables at rest, and
nothing in this repository stores an environment value anywhere else.
`.env.local` is git-ignored and `.env.example` carries names with no values.

The one thing this codebase adds is failing at boot rather than at first use:
`server/core/config.ts` parses everything once and throws on anything missing
or malformed.

---

## Open, with dates

### Spike 0.4 — attachment payload ceiling · open since 2026-09-05

Unmeasured. Not a vulnerability, but it is the one unknown that could change
the ingress architecture (§5.1), and it stays on this list until a real
delivery has been measured.

### DNS rebinding between our lookup and `fetch`'s · accepted 2026-09-08

`assertSafeWebhookUrl` resolves and rejects private addresses at configuration
time and again immediately before every delivery, and redirects are never
followed. `fetch` still performs its own resolution, so a record that changes
between our lookup and its lookup is not covered.

Closing it needs a custom agent that dials the address we validated. **Accepted
for now**: the window is milliseconds, and the attacker must already control
DNS for a hostname the operator typed in themselves. Revisit if endpoint URLs
ever become configurable by anyone but the operator.

### Orphaned storage objects · accepted 2026-09-06

Attachment bytes are written before the row, so a delivery that turns out to be
a duplicate leaves objects nothing references. That is the correct direction to
fail — the alternative is a committed row pointing at a key that does not exist
— and retention now prunes by age regardless, so orphans do not accumulate
forever when a policy is set. A dedicated sweep is still owed.

### No backup/restore drill has been performed · open

The procedure is written in [`runbooks.md`](./runbooks.md). It has not been
executed, because there is no deployed database to restore. **This is the one
item on this page that cannot be closed by writing code**, and Phase 11's
acceptance criterion is explicit that a restore must actually have been
performed, not just documented.
