# Mailpiston — Project Roadmap

> Companion to [`execution_plan.md`](./execution_plan.md).
> The execution plan is the **specification** (what the system is).
> This roadmap is the **build order** (what we do, in what sequence, and how we know a phase is done).

---

## 0. Reading this document

| Section | Purpose |
| --- | --- |
| §1 Findings | What the Inbound + Forward Email research changed about the plan |
| §2 Scaffolding decision | The recommended shape of the repo and why |
| §3 Prototype cut line | The smallest thing worth building first |
| §4 Phases | P0 → P11, each with scope, deliverables, acceptance |
| §5 Open questions | Decisions the roadmap deliberately defers to you |

Conventions used below:

- **Deliverables** are file paths relative to the repo root.
- **Acceptance** is a checklist that must pass before the next phase starts.
- **⚠️** marks a deviation from `execution_plan.md`, with the reason.

---

## 1. Research findings that change the plan

Sources: the [inbound repo](https://github.com/inboundemail/inbound), the
[Forward Email API reference](https://forwardemail.net/en/email-api),
[Forward Email pricing](https://forwardemail.net/en/pricing), and Forward Email's own
[webhook server example notes](https://github.com/forwardemail/forward-email-webhook-server-dot-net).

### 1.1 The cost thesis holds

Forward Email **Enhanced Protection is ~$3/mo and includes unlimited domains *and* unlimited
aliases**, ~9,000 outbound messages/month over SMTP, and developer API access. Nothing in their
pricing scales with domain count. The core premise of the project — avoid $15/mo per-domain-tier
pricing and pay only for volume — is confirmed, not assumed.

The binding limit is **outbound volume**, not domains. Track outbound count as a first-class metric
from Phase 6 onward so the ceiling is visible before it is hit.

### 1.2 Forward Email ingress is "alias → HTTPS URL", not a webhook subscription

Forward Email has no "register a webhook for inbound mail" concept. Instead an **alias recipient may
itself be an `https://` URL**; Forward Email POSTs the parsed message there. Configurable via the API
(`POST`/`PUT /v1/domains/{domain}/aliases`) or a DNS TXT record (`forward-email=alias:https://…`).

**Consequence — ⚠️ use a hybrid alias model.** This is generic across every domain managed by
MailPiston; all examples and acceptance tests use throwaway fixture domains rather than product-specific code.

`execution_plan.md` §4.2 gives `Address.providerAliasId`, implying an alias per address. Register
instead:

```
*@customer-domain.com  →  https://mailpiston.vercel.app/api/providers/forward-email/inbound
```

Use the catch-all for local, inbound-only routes. Create a concrete Forward Email alias for every
address that must send or relay replies, because Forward Email's outbound API requires the `from`
address to exist as an alias. For example, any domain can have:

```
*@customer-domain.com       → MailPiston ingress (optional inbound-only routes)
support@customer-domain.com → MailPiston ingress (concrete, send/reply capable)
```

Then:

- inbound-only address CRUD can remain purely local behind the catch-all;
- send/reply-capable address CRUD includes one provider alias call and stores `providerAliasId`;
- reconciliation checks the optional catch-all plus every concrete send-capable alias.

Cost of the catch-all: we now receive mail for *every* local part, including addresses that do not
exist. Mailpiston must resolve the recipient locally and **drop unknown local parts** — persist a
lightweight `rejected` event for visibility, return `200`, create no email row, fire no endpoint. Do
not bounce (bouncing a catch-all is backscatter).

`Address.providerAliasId` remains nullable: null means an inbound-only local route behind a
catch-all; non-null means a concrete provider alias that can send/reply. For the first support-inbox
vertical slice, prefer a concrete alias and do not require a catch-all.

### 1.3 Inbound webhook authenticity is solved and specified

Forward Email signs the request:

```
X-Webhook-Signature: <hex HMAC-SHA256 of the raw request body, keyed with the domain's webhook key>
```

This satisfies `execution_plan.md` §8 exactly. Two implementation requirements:

1. **Read the raw body first.** In a Next.js route handler, `await request.text()`, verify, *then*
   `JSON.parse`. Calling `request.json()` first consumes the stream, and re-serializing will not
   reproduce a byte-identical body.
2. **Compare with `crypto.timingSafeEqual`** on equal-length buffers, never `===`.

### 1.4 Forward Email's inbound payload shape

The POST body is essentially `mailparser` output plus SMTP session context:

```
html, text, textAsHtml, subject, date
from, to, cc, bcc, replyTo          // parsed address objects: { value: [{ address, name }], text }
messageId, inReplyTo, references
headers, headerLines                // headerLines is the ordered raw array
recipients                          // the envelope recipients that caused THIS delivery
attachments[]                       // filename, contentType, size, content (base64)
raw                                 // the complete original MIME source
session                             // sender, arrival, helo, clientHostname, remoteAddress
```

Two things follow:

- `recipients` (envelope), **not** the `To:` header, is the authority on which Mailpiston address was
  hit. A message BCC'd to `support@` has no `To: support@` header at all. The normalizer must key off
  `recipients`.
- `raw` plus base64 `attachments` mean the payload can be **large**. See §5.1.

### 1.5 What we take from Inbound, and what we refuse

| Inbound has | Verdict |
| --- | --- |
| `emails.send()` / `.reply()` SDK ergonomics | **Adopt the capability.** This is the product. |
| One typed endpoint concept for webhook, email, and email-group destinations | **Adapt.** Keep the clean user model, typed relational config, and many-to-many address bindings |
| Typed webhook payload + runtime guard shipped in the SDK | **Adopt the capability, not the payload verbatim.** Publish a smaller MailPiston-owned v1 contract |
| Stainless-generated OpenAPI client | **Defer.** Hand-write a small SDK in Phase 7; revisit only if the surface grows |
| S3 attachment storage | **Copy** the idea, on R2 |
| AWS CDK, SES receipt rules, Lambda mail functions | **Refuse.** Forward Email replaces this entire layer — it is the reason we are not forking |
| Billing, plans, usage metering, seats, orgs | **Refuse.** Single-operator system |
| Marketing site, onboarding flows, AI features | **Refuse.** |

Concretely: **fork nothing as a foundation**. Inbound's application is MIT licensed, while its
Stainless configuration declares the generated SDK Apache-2.0. Pin and preserve the license of any
specific source later copied. Spike 0.11 is complete and recorded in
`docs/spikes/inbound-source-read.md`; §5.7 records the resulting public-contract decision.

### 1.6 Corrections to specific code in the execution plan

- **⚠️ Neon driver.** §9.4's `db.transaction` with `SELECT … FOR UPDATE` requires an *interactive*
  transaction. The Neon **HTTP** driver (`neon()`) cannot do this — it is one round trip per
  statement. Use the **WebSocket pool** driver (`Pool` from `@neondatabase/serverless`, i.e.
  `drizzle-orm/neon-serverless`) for anything using `FOR UPDATE`, `SKIP LOCKED`, or a multi-statement
  transaction. The HTTP driver is fine for simple reads. Plan for **both** exports from `db/client.ts`.
- **⚠️ `middleware.ts` no longer exists.** Next.js 16 renamed it to **`proxy.ts`** at the project
  root, exporting `proxy` (default or named). It defaults to the Node.js runtime and rejects a
  `runtime` export.
- **⚠️ Route handler `params` are Promises**: `{ params }: { params: Promise<{ id: string }> }`.
- **⚠️ Do not set `export const runtime`.** Node.js is the default in Next 16 and the Edge runtime is
  deprecated, as is `preferredRegion`. Set `export const maxDuration` where a handler is genuinely slow.
- **Rate limiter 429 path.** Throwing `RateLimitError` inside the transaction (§9.4) rolls back the
  increment, so a rejected request does not consume quota. That is the behaviour we want, but it is
  accidental in the plan's code — make it deliberate and comment it.

### 1.7 Gaps in the execution plan

The plan has no answer for these. The roadmap fills them in:

1. **Dashboard authentication.** §20 lists nine dashboard pages and §24 lists API-key hashing, but
   nothing authenticates a *human*. Added in Phase 1.
2. **Tenancy.** There is no `users` or `workspaces` table anywhere in §17. This is correct for a
   single-operator tool and we are keeping it — but it must be a stated decision, because retrofitting
   an `owner_id` onto every table later is expensive. **Decision: single-tenant.** No owner column
   anywhere. If multi-tenant is ever needed it arrives as a deliberate v2 with a migration, not a bolt-on.
3. **Unknown-recipient handling.** Required by the catch-all decision (§1.2). Added in Phase 4.
4. **Outbound quota awareness.** Forward Email exposes a daily outbound count and limit; its pricing
   separately advertises a monthly allowance. Track and label both accurately in Phase 6.
5. **Local development ingress.** Provider webhooks cannot reach `localhost`. Added in Phase 0.
6. **Private personal-inbox replies.** Added typed email endpoints, opaque reply routes, sender
   verification, and header reconstruction in Phase 6.

---

## 2. Scaffolding decision

### 2.1 Where code lives — ⚠️ `server/`, not `src/`

`execution_plan.md` §21 proposes `src/`. The repo is already committed to root-level `app/`,
`components/`, `lib/`, with `tsconfig.json` mapping `@/*` → `./*` and `components.json` pointing
shadcn at `@/components`. Moving to `src/` means rewriting both configs and every generated shadcn
path, for no benefit.

Instead, keep the Next.js convention at the root and put **all backend domain code under a single
`server/` directory** that mirrors the plan's structure one-to-one:

```
mailpiston/
├── app/
│   ├── (dashboard)/              # authenticated UI, route group
│   │   ├── layout.tsx            # shell: sidebar + topbar
│   │   ├── page.tsx              # Overview
│   │   ├── inbox/ sent/ threads/ logs/
│   │   ├── domains/ addresses/ endpoints/ forwarding/
│   │   └── settings/ api-keys/
│   ├── (auth)/sign-in/
│   ├── api/
│   │   ├── v1/                   # public REST API (API-key auth)
│   │   │   └── domains/ addresses/ emails/ threads/ endpoints/ events/ api-keys/
│   │   ├── providers/forward-email/
│   │   │   ├── inbound/route.ts  # HMAC-verified ingress
│   │   │   └── events/route.ts   # bounce / delivery events
│   │   ├── inngest/route.ts      # Inngest serve handler
│   │   └── auth/[...all]/route.ts
│   ├── layout.tsx
│   └── globals.css               # the single theme source (§2.4)
│
├── components/
│   ├── ui/                       # shadcn primitives (generated)
│   ├── layout/                   # app-shell, sidebar, nav
│   ├── mail/                     # EmailList, EmailViewer, ThreadView, EventTimeline
│   └── icon.tsx                  # the icon fallback chain (§2.5)
│
├── server/                       # ← everything below is server-only
│   ├── core/
│   │   ├── errors/               # APIError hierarchy + formatErrorResponse (plan §16)
│   │   ├── auth/                 # session guard, API-key issue/hash/verify
│   │   ├── rate-limit/           # transactional fixed-window limiter (plan §9)
│   │   ├── idempotency/          # atomic claim (plan §10)
│   │   ├── crypto/               # HMAC, timing-safe compare, token hashing, secret encryption
│   │   ├── http/                 # route wrappers: withApi / withProvider (§2.3)
│   │   └── validation/           # zod schemas, shared by API + forms
│   ├── mail/                     # services (business logic)
│   │   ├── domains/ addresses/ endpoints/ forwarding/
│   │   ├── emails/               # InboundEmailService, OutboundEmailService
│   │   ├── threads/              # DefaultThreadResolver
│   │   └── events/
│   ├── providers/
│   │   ├── MailProvider.ts       # the interface — nothing outside this dir names Forward Email
│   │   ├── registry.ts
│   │   ├── forward-email/        # Client / Provider / Normalizer / Verifier
│   │   └── mock/                 # MockMailProvider for tests + local dev
│   ├── repositories/             # persistence only, one per aggregate
│   ├── db/
│   │   ├── client.ts             # pooled (tx-capable) + http (read) clients
│   │   ├── schema/               # drizzle schema, one file per table group
│   │   └── migrations/           # drizzle-kit generated SQL
│   ├── jobs/inngest/             # client + functions
│   └── storage/                  # R2Storage
│
├── lib/                          # client-safe utilities only (cn, formatters, hooks)
├── docs/
└── proxy.ts                      # Next 16 (was middleware.ts)
```

Why one `server/` root rather than eight top-level directories:

- **One boundary to enforce.** A single ESLint `no-restricted-imports` rule — "nothing under
  `components/` or `lib/` may import `@/server/*`" — protects the whole backend. With eight top-level
  dirs you need eight rules and they rot.
- **Provider leakage is greppable.** `grep -rn "forward-email" --include=*.ts . | grep -v server/providers/`
  returning anything is a bug, and that is a CI check.
- **It matches the plan's tree exactly**, just nested one level, so §21's strict rules transfer verbatim.

### 2.2 Dependencies to add

Already present: `next@16.3.4`, `react@19.2.8`, `tailwindcss@4`, `shadcn`, `@hugeicons/react`,
`@hugeicons/core-free-icons`, `@base-ui/react`, `framer-motion`, `react-hook-form`, `typescript`.

```bash
# data
bun add drizzle-orm @neondatabase/serverless ws
bun add -d drizzle-kit @types/ws

# validation, jobs, storage, ids
bun add zod inngest @aws-sdk/client-s3 @aws-sdk/s3-request-presigner nanoid

# email parsing (outbound MIME + any raw re-parse)
bun add mailparser
bun add -d @types/mailparser

# auth (see Phase 1 / §5.5)
bun add better-auth

# icon fallback chain, per the standing stack spec
bun add @heroicons/react react-icons

# forms + tests
bun add @hookform/resolvers
bun add -d vitest @vitest/coverage-v8
```

`vercel` is currently listed as a runtime dependency in `package.json` — move it to `devDependencies`.

### 2.3 The route wrapper — where the four concerns get composed

`execution_plan.md` §7 insists authenticity, rate limiting, idempotency, and retry are **separate
systems**. They still need one ordered composition point, or every route re-implements the order and
one of them eventually gets it wrong. Two wrappers, in `server/core/http/`:

```ts
// Public API routes: /v1/*
withApi(handler, { endpoint: '/v1/emails/send' })
//  1. resolve API key      → AuthError        (401)
//  2. rate limit (failClosed on privileged mutations) → RateLimitError (429)
//  3. validate body (zod)  → ValidationError   (400)
//  4. run handler
//  5. formatErrorResponse on throw

// Provider ingress: /api/providers/*
withProvider(handler, { provider: 'forward-email', endpoint: '/api/providers/forward-email/inbound' })
//  1. read RAW body (text)                                    ← must be first
//  2. verify HMAC signature → WebhookVerificationError (401)  ← before any spend
//  3. rate limit, failOpen                                    ← already authenticated
//  4. parse + normalize
//  5. run handler (which claims the idempotency key itself)
//  6. ALWAYS 200 on downstream failure; endpoint trouble never rejects ingress
```

Idempotency deliberately does **not** live in the wrapper: the fingerprint is derived from the
*normalized* payload, so only the handler knows it. Retry lives entirely in Inngest and never touches
an inbound request path.

### 2.4 Theme

`execution_plan.md` §21 requires "all spacing, colors, typography, radii, shadows, and layout tokens
come from one global theme source". With Tailwind v4 that source is the `@theme` block in
`app/globals.css`, already present with the shadcn `base-mira` token set. **⚠️ Do not add
`server/theme/theme.ts`** — a second token source in TypeScript would immediately drift from the CSS
one. Any token a component needs is a CSS variable; anything computed in TS reads `var(--token)`.

### 2.5 Icons

Per the standing stack spec: **Hugeicons primary → Heroicons fallback → react-icons last resort.**
`components.json` already sets `"iconLibrary": "hugeicons"`. Add `components/icon.tsx` as the single
import site, so the fallback tier of any given glyph is visible in one file rather than scattered
across features, and so swapping a fallback for a Hugeicons glyph later is a one-line change.

---

## 3. The prototype cut line

The smallest usable build that proves the actual human-support workflow is **Phase 0 → Phase 6,
plus a hardcoded slice of Phase 7**. It is provider- and domain-agnostic; the test domain is only a
fixture. It produces one demonstrable loop:

```
real email → any managed address → Forward Email MX → concrete alias
  → HMAC-verified POST to Mailpiston → normalized + persisted in Neon
  → visible in the dashboard
  → signed POST to one configured HTTP endpoint (optional)
  → safe notification to one verified personal inbox (optional)
  → personal reply to opaque relay address
  → reconstructed reply sent from the managed address
  → reply stored in the original thread + outbound event sent to the HTTP endpoint
```

If that loop works, everything after it is addition rather than product validation. Inngest retries,
reconciliation, generalized SDK polish, and full attachment hardening can follow, but thread and
privacy-safe reply behavior are part of the prototype because they are the core operator workflow.

Build the prototype against **one throwaway domain** you do not care about. Do not point a real
product domain at Mailpiston before Phase 11.

---

## 4. Phases

### Phase 0 — Recon and spikes

**Goal:** kill the unknowns that could force a rewrite, before writing the schema.

Each spike is a throwaway script or scratch route — none of this ships.

| # | Spike | Question it answers |
| --- | --- | --- |
| 0.1 | Point a throwaway domain's MX at Forward Email; create a catch-all alias → a request-bin URL | Does catch-all → HTTPS actually deliver? |
| 0.2 | Capture 5 real payloads: plain text, HTML, with attachment, a reply (has `In-Reply-To`), a BCC-only delivery | Locks the normalizer contract against reality, not docs |
| 0.3 | Verify `X-Webhook-Signature` against the domain's webhook key in a scratch Node script | Confirms the exact secret, encoding (hex vs base64), and what bytes are signed |
| 0.4 | **Payload ceiling.** Send a 1 MB, 5 MB and 15 MB attachment | Does Forward Email truncate, drop `raw`, or fail? Does it exceed Vercel's request body limit? Determines §5.1 |
| 0.5 | **Private relay loop.** After MailPiston ingests a message, send a constructed notification to a test personal inbox with an opaque `Reply-To`; reply and inspect the final customer-visible raw headers | Proves application-controlled forwarding, token routing, threading, and that the personal address is absent from transport headers |
| 0.6 | Send outbound via `POST /v1/emails` and inspect the resulting `Message-ID` and headers | Do we control `Message-ID`? Threading in Phase 5 depends on the answer |
| 0.7 | Trigger a hard bounce (send to a known-dead address) with `bounce_webhook` configured | Confirms the bounce payload shape and whether it is signed the same way |
| 0.8 | Stand up local ingress: `untun` / ngrok / a Vercel preview deploy | How we develop Phase 4+ at all |
| 0.9 | **Send *as* an address that only exists behind the catch-all.** Try `POST /v1/emails` with `from: support@<test-domain>` when the only alias on the domain is `*@` | ⭐ Does catch-all ingress compose with outbound? If Forward Email requires a concrete alias to authorise a `From:`, §1.2 needs a carve-out |
| 0.10 | Run `GET /v1/domains/{domain}/verify-smtp` and inspect what DKIM/SPF/DMARC records it demands beyond the inbound MX set | Phase 3's DNS table must cover sending, not just receiving |
| 0.12 | Send a relay reply from the wrong personal address, then revoke the token and retry from the correct address | Proves sender authorization and revocation fail closed |

#### 0.11 — Scoped source read of Inbound

**Completed 2026-09-05.** The sibling checkout was read as prior art, not forked as a foundation. The
full decision record is `docs/spikes/inbound-source-read.md`.

The main application is MIT licensed. Its Stainless config declares the generated SDK Apache-2.0,
and this checkout's `packages/inbound-typescript-sdk` is an unpopulated gitlink with no matching
`.gitmodules` entry. Therefore we can learn from the live API schemas, but must pin the upstream SDK
revision and license before copying SDK code.

**Paths read:**

| Path | What it answers |
| --- | --- |
| `packages/inbound-typescript-sdk`, `stainless.yml`, and active route schemas | SDK surface, license boundary, and public contract |
| endpoint/routing model (`lib/email-management`, `app/api/e2`, schema) | Typed destinations, delivery claims, fan-out limitations, and Phase 6/7 prior art |
| thread and reply services | Header-only thread resolution, reply ergonomics, and race risks |
| mail/thread route shapes | Unified mailbox response and pagination sanity check |

Their `aws/cdk/`, `smtp-gateway`, `imap-gateway` and mail transport functions remain out of scope.
Forward Email replaces that layer.

**Guardrails:**

- Clone to a **sibling** directory of this repo, never a subdirectory and never a submodule, so it
  cannot enter our git history or our `tsconfig` include path.
- Anything lifted verbatim carries its exact upstream license and attribution in a provenance file.
- Having the repo locally makes copying frictionless, and most of what is easy to copy is the part we
  decided not to build. The scoped path list above is the mitigation — respect it.

**Deliverable:** `docs/spikes/inbound-source-read.md`, including the decision on §5.7.

**Deliverables:** `docs/spikes/forward-email-findings.md`, with the five captured payloads committed
as JSON fixtures under `server/providers/forward-email/__fixtures__/`. Those fixtures are the
normalizer's test suite for the life of the project.

**Acceptance**
- [ ] A real email sent from Gmail lands on a request bin via a catch-all alias
- [ ] The signature verifies in a standalone script
- [ ] The attachment ceiling is a known number, written down
- [ ] 0.5 produces a customer-visible `.eml` fixture with no personal address in source, return path,
      message id, routing, or authentication headers
- [ ] 0.12 rejects both the wrong sender and the revoked relay without sending customer mail
- [ ] 0.9 has a yes/no answer — if "no", §1.2 gains a rule: **create a concrete alias for every
      address that must be able to send**, while the catch-all still handles all inbound
- [ ] Five payload fixtures are committed
- [x] `docs/spikes/inbound-source-read.md` exists and takes a position on §5.7
- [x] The Inbound clone lives outside this repo and appears nowhere in `git status`

---

### Phase 1 — Foundation

**Goal:** an empty but *correct* application that deploys, connects, migrates, and authenticates.

**Scope**

1. **Config.** `server/core/config.ts` — a zod-parsed `env` object that throws at boot on a missing
   var. No bare `process.env` anywhere else.
2. **Database.** `server/db/client.ts` exporting both a pooled tx-capable client and an HTTP read
   client (§1.6). Drizzle schema for the full table list in plan §17. Generate and run the first
   migration.
3. **Error model.** `server/core/errors/` — the complete hierarchy and `formatErrorResponse` from
   plan §16, verbatim.
4. **Repositories.** Interface + Neon implementation per aggregate, returning the domain types from
   plan §4. Empty method bodies are fine; the *shape* is the deliverable.
5. **Route wrappers.** `withApi` / `withProvider` from §2.3, with a `/api/v1/health` route proving the
   happy path and a deliberately-throwing route proving the error path.
6. **Auth (new — plan gap §1.7.1).** Single operator. **Recommendation: Better Auth with GitHub
   OAuth, allow-listing exactly one email address** via `ALLOWED_OPERATOR_EMAILS`. No sign-up flow,
   no password reset, no user-management UI. Session guard in `server/core/auth/`; `proxy.ts`
   redirects unauthenticated `(dashboard)` requests to `(auth)/sign-in`.
7. **Dashboard shell.** Sidebar with the nine items from plan §20, every page present as an empty
   state. `components/icon.tsx` per §2.5.
8. **CI.** `bun run lint`, `tsc --noEmit`, `vitest run`, and the provider-leak grep from §2.1.

**Acceptance**
- [ ] `vercel deploy` succeeds and the deployed app reaches Neon
- [ ] `drizzle-kit migrate` runs cleanly against a fresh database
- [ ] Signing in as the allow-listed account works; any other account is rejected
- [ ] `/api/v1/health` returns 200; the throwing route returns a correctly shaped `APIError` JSON body
- [ ] `tsc --noEmit` is clean and the provider-leak grep returns nothing

---

### Phase 2 — Forward Email provider adapter

**Goal:** the only code in the repo that knows Forward Email exists.

**Scope**
- `MailProvider.ts` — the interface from plan §5, unchanged.
- `ForwardEmailClient` — thin HTTP client over `https://api.forwardemail.net`, Basic auth with the
  API token as username and an empty password. Typed responses, `ExternalAPIError` /
  `ProviderTimeoutError` on failure, explicit timeout, no retries at this layer.
- `ForwardEmailProvider` — implements `MailProvider` in terms of the client.
- `ForwardEmailVerifier` — raw-body HMAC-SHA256 + `timingSafeEqual` (§1.3).
- `ForwardEmailNormalizer` — payload → `NormalizedInboundEmail`, keying the recipient off the
  envelope `recipients` array (§1.4), address objects flattened to strings, `references` parsed into
  an array, attachments split into metadata + base64 content.
- `MockMailProvider` — in-memory; drives tests and local dev with no network.
- `registry.ts` — `mailProviderRegistry.get('forward-email')`, provider chosen by env.

**Acceptance**
- [ ] Each of the five Phase 0 fixtures normalizes to the expected `NormalizedInboundEmail`, as unit tests
- [ ] Signature verification passes on a real captured request and fails on a single flipped byte
- [ ] Against a live throwaway domain: create domain → verify records → create catch-all alias →
      delete alias, all via the provider interface
- [ ] `grep -rn "forwardemail\|forward-email" --include=*.ts . | grep -v "server/providers/forward-email"`
      returns nothing

---

### Phase 3 — Domains and addresses

**Goal:** onboarding a domain is a self-service flow in the dashboard.

**Scope**
- `DomainService`: create → provider `createDomain` → persist `pending` → surface the required DNS
  records (MX, SPF, DKIM, DMARC, verification TXT) → `verifyDomain` polls
  `GET /v1/domains/{domain}/verify-records` → `verified` | `failed`.
- `AddressService`: CRUD for (`localPart` + `domainId`, unique together, case-insensitive) with an
  explicit `canSend` capability. A send/reply-capable address creates a concrete Forward Email alias
  pointing at our ingress and stores `providerAliasId`; an inbound-only address may remain local
  behind an optional catch-all.
- Catch-all creation is optional domain configuration, not a prerequisite for a managed mailbox.
- `/v1/domains/*` and `/v1/addresses/*` per plan §6.
- Dashboard: Domains list with status badges and a copyable DNS-record table; Addresses list with
  inline create.

**Acceptance**
- [ ] Add a domain in the UI, follow the displayed DNS instructions, and reach `verified`
- [ ] Create send-capable `support@<test-domain>`; its concrete Forward Email alias points at ingress
- [ ] Create an inbound-only local address behind a catch-all and verify that no per-address provider
      call is made
- [ ] Creating a duplicate address returns a `ConflictError`, not a 500

---

### Phase 4 — Inbound email (⭐ the load-bearing phase)

**Goal:** a real external email becomes exactly one durable, normalized record.

**Scope** — the pipeline from plan §11, in order:

```
raw body → verify HMAC → rate limit (failOpen) → normalize
  → resolve recipient address (concrete alias or optional catch-all)
      ├─ unknown local part → record 'email.rejected' event, return 200, stop
      └─ known → claim idempotency key
                   ├─ already claimed → return { received: true, duplicate: true }
                   └─ claimed → persist email → create 'email.received' event
                                → enqueue endpoint deliveries → 200
```

- `createInboundFingerprint` per plan §10.1, **extended with the resolved `addressId`** so a single
  message fanned out to two of our addresses produces two rows rather than being deduplicated into one.
- Attachments: metadata to Neon, bytes to R2 (`server/storage/R2Storage.ts`), keyed
  `attachments/{emailId}/{attachmentId}`. Never store bytes in Postgres.
- **`raw` MIME**: store to R2 as well, behind a `STORE_RAW_MIME` flag. It is the single best debugging
  artifact and it is large — make it toggleable from day one.
- Dashboard: Inbox list + email viewer (sanitized HTML in a sandboxed iframe — **not**
  `dangerouslySetInnerHTML`), attachment download via presigned R2 URLs.

**Acceptance**
- [ ] An email sent from a real external account to `support@<test-domain>` appears in the Inbox
- [ ] Replaying the identical provider POST creates **no** second row and returns `duplicate: true`
- [ ] A request with a tampered body returns 401 and writes nothing
- [ ] Mail to `nonexistent@<test-domain>` returns 200, creates no email, and is visible as a rejected event
- [ ] A message with a 2 MB PDF stores metadata in Neon and bytes in R2, and downloads intact
- [ ] Ingress p95 stays under ~2 s with a realistic payload

> This completes durable inbound capture. The usable support-inbox prototype cut line is at Phase 6.

---

### Phase 5 — Threads

**Scope:** `DefaultThreadResolver` exactly as plan §12 — `In-Reply-To`, then `References`, then a
known provider/message mapping, then **stop**. ⚠️ Do **not** implement the "conservative subject +
participant fallback" in v1. Ship the first three, measure how many messages land thread-less, and
only then decide whether the fallback earns its false-merge risk. Wrongly merging two customers'
threads is a data-leak-shaped bug; an orphan thread is cosmetic.

Index `emails.message_id`; add the `thread_id` FK. Thread list + conversation view in the dashboard.

**Acceptance**
- [ ] inbound → reply → inbound reply stays one thread
- [ ] Two unrelated emails that happen to share a subject stay in two threads
- [ ] A message with no threading headers creates its own thread and attaches to nothing

---

### Phase 6 — Outbound and replies

**Scope**
- `POST /v1/emails/send` and `POST /v1/emails/:id/reply` (plan §6).
- Reply construction sets `In-Reply-To` to the parent's `Message-ID` and appends to `References`, so
  the *recipient's* mail client threads correctly too — not just ours.
- Persist outbound as `Email` with `direction: 'outbound'`, status `queued → sent`, attached to the
  parent's thread.
- Consume the bounce webhook at `/api/providers/forward-email/events` → `soft_bounced` / `hard_bounced`.
- **Outbound quota.** Poll `GET /v1/emails/limit`, cache it, and display the provider's returned
  daily `count` and `limit`; show the advertised monthly allowance separately rather than deriving
  one from the other.
- Shared `Endpoint` CRUD and `address_endpoints` many-to-many bindings. Phase 6 initially enables the
  `email` and `email_group` subtypes; every recipient is independently verified and revocable.
- Application-controlled forwarding after durable ingress. Construct a new internal notification;
  never configure the personal address as a direct provider forwarding recipient.
- Opaque `reply+<token>@reply.mailpiston.com` routes bound to address + thread + verified forwarding
  endpoint recipient. Store token hashes, support expiry/revocation, and require envelope-sender equality.
- Relay replies are parsed and rebuilt as fresh customer-facing mail. Never reuse personal raw MIME,
  Message-ID, Return-Path, Received, Sender, or authentication headers.
- Emit the relayed outbound/thread event to every HTTP endpoint bound to the managed address.
- Public endpoint payloads contain only customer-facing message data. Personal destinations, relay
  tokens, and personal transport metadata remain private operator audit data.
- Configure one MailPiston-owned relay domain (`reply.mailpiston.com`) with a catch-all
  routed exclusively to MailPiston ingress; it serves every managed customer domain.
- Count constructed personal notifications as internal outbound mail. A handled inbound message can
  consume two outbound sends—one notification to the operator and one relayed reply to the customer—
  and additional email endpoint recipients add additional sends.
- Fail **closed** on the rate limiter for both send routes (plan §9.5).

**Acceptance**
- [ ] Send a new message; it arrives, and appears in Sent
- [ ] Reply to an inbound email; **Gmail threads it with the original**
- [ ] Both appear in the correct Mailpiston thread with a status timeline
- [ ] A send to a known-dead address flips to `hard_bounced` from the bounce webhook
- [ ] Exceeding the send rate limit returns 429 with `resetAt`
- [ ] Bind a verified personal inbox to `<local-part>@<test-domain>`; incoming mail reaches both the
      MailPiston Inbox and that personal inbox
- [ ] Reply from the personal inbox; the customer sees only `<local-part>@<test-domain>`, the reply lands
      in the original MailPiston thread, and a configured HTTP endpoint receives the outbound event
- [ ] The customer-visible raw message contains no personal address in transport headers
- [ ] Wrong-sender and revoked-token relay attempts send nothing and create audit events

---

### Phase 7 — Webhook endpoints

**Scope**
- Enable the `webhook` subtype in the shared endpoint CRUD and add a test-delivery action.
- Generate each signing secret once and show it once. Store it encrypted at rest (or derive it from a
  master key), because MailPiston must recover signing material; a hash alone cannot sign deliveries.
- Reuse `address_endpoints` many-to-many, so one webhook can serve several addresses and one address
  can fan out to webhook and email endpoints together.
- The provider-independent payload from plan §13 — this shape is a **public contract**; version it
  (`"version": "1"`) from the first delivery.
- Signed headers per plan §14: `X-Mailpiston-Event`, `-Delivery-Id`, `-Timestamp`, `-Signature`.
- Sign `timestamp + "." + body`, not the body alone, so the timestamp is covered and replay windows
  are enforceable.
- Synchronous first attempt on ingest; failure records a `pending` delivery and stops. **Retry is
  Phase 8** — do not build a retry loop here.
- Delivery log UI: status, response code, last error, attempt count.
- Require HTTPS; resolve and reject private, loopback, link-local, and metadata-service addresses at
  delivery time as well as at configuration time to resist DNS rebinding.
- Small hand-written TypeScript SDK: `verifyWebhook(req, secret)` plus payload types (§1.5).

**Acceptance**
- [ ] Mail to `support@` POSTs to the configured endpoint within seconds
- [ ] The receiving app verifies the signature with the published snippet
- [ ] A stale timestamp fails verification
- [ ] An endpoint returning 500 leaves a `pending` delivery row with the response code recorded, and
      **ingress still returns 200**

---

### Phase 8 — Inngest retry engine

**Scope:** plan §15 as written. Neon owns state, Inngest owns timing. Atomic claim via the
conditional `UPDATE … WHERE status IN ('pending','failed') RETURNING *`. Backoff
`0 / 30s / 2m / 10m / 1h / 6h / 24h` with jitter. Final failure sets `status = 'failed'`,
`next_attempt_at = NULL`, and emits nothing further. Manual retry button in the delivery log, routed
through the same claim path.

⚠️ Hold the plan's own §15.7 line: **no Redis, no BullMQ, no Vercel Cron retry scanner, no worker.**
If Inngest cannot express something, the answer is a simpler design, not more infrastructure.

**Acceptance**
- [ ] A 500 schedules a retry; a subsequent 200 stops the chain
- [ ] Two concurrent Inngest executions cannot both deliver the same delivery (verify with a forced
      duplicate event)
- [ ] After the final attempt the delivery is `failed`, with full attempt history inspectable
- [ ] Manual retry works and does not bypass the claim

---

### Phase 9 — Event timeline

**Scope:** one unified stream over every `MailEventType` in plan §4.7, plus `email.rejected` from
Phase 4. `GET /v1/events` with cursor pagination. Logs page with filters (type, address, date,
endpoint), and a per-email timeline component reused inside the email viewer.

**Acceptance**
- [ ] Every message has a complete audit trail from receipt to final endpoint delivery
- [ ] Filtering by endpoint shows only that endpoint's deliveries
- [ ] The timeline renders correctly for a message whose delivery ultimately failed

---

### Phase 10 — Provider reconciliation

**Scope:** an Inngest cron (`0 */6 * * *`) comparing Mailpiston domains against Forward Email
domains and — now cheap, thanks to §1.2 — checking that each verified domain's **catch-all alias
still exists and still points at our current ingress URL**. Write results to
`provider_reconciliation_runs` / `_items`. **Detect and display drift; never auto-repair silently.**
Surface a banner on the Domains page when drift exists.

**Acceptance**
- [ ] Manually deleting a catch-all alias in the Forward Email dashboard raises a drift warning within one cycle
- [ ] Manually repointing a catch-all at a different URL is detected
- [ ] Nothing is repaired without an explicit click

---

### Phase 11 — Hardening and migration

**Scope**
- Security pass against the full checklist in plan §24.
- Rotation runbooks: API keys, endpoint secrets, the Forward Email webhook key.
- Retention: how long `raw` MIME and attachments live in R2, and the job that prunes them.
- Backup/restore drill against Neon.
- Then migrate domains in the batches from plan §23 — 2 test → 3 low-risk → 10 → 15 → remainder —
  running the full per-batch checklist (MX, SPF, DKIM, DMARC, inbound, outbound, reply, threading,
  personal forwarding, endpoint delivery, bounce event, logs) each time.

**Acceptance**
- [ ] Every §24 item is implemented or has a written, dated exception
- [ ] A restore from backup has actually been performed, not just documented
- [ ] Batch 1 runs a week with zero lost messages before Batch 2 starts

---

## 5. Open questions

Each has a recommendation and a phase where it becomes blocking.

### 5.1 Attachment payload ceiling — *blocking Phase 4, answered by spike 0.4*

Forward Email inlines base64 attachments **and** the full `raw` MIME in the webhook JSON. Vercel
serverless functions cap the request body at roughly 4.5 MB, so a 6 MB PDF may never reach us.

**Recommendation:** measure first (0.4). If the ceiling bites, the fix is *not* to move off Vercel —
it is to route the catch-all to a small Cloudflare Worker that streams the body to R2 and POSTs
Mailpiston a pointer payload instead. That preserves the whole architecture and adds one stateless
component. Decide only if 0.4 says we need it.

### 5.2 Personal inbox forwarding — *decided by spike 0.5*

**Decision: application-controlled forwarding for every managed domain.** MailPiston constructs a
safe notification after durable ingress and sets an opaque MailPiston relay address as `Reply-To`.
It does not add the personal address directly as a Forward Email alias recipient. This is required
to record delivery, authorize the replying person, preserve the MailPiston thread, notify HTTP
endpoints, and reconstruct outbound mail without exposing personal transport headers.

### 5.3 Header namespace — *recommendation; decide before Phase 7*

Use `X-Mailpiston-*`. Renaming a public webhook header after third-party apps depend on it is a
breaking change; renaming it now costs nothing.

### 5.4 Single-tenant, confirmed? — *blocking the Phase 1 schema*

No `users` / `workspaces` / `owner_id` anywhere. **Recommendation: yes, single-tenant.** It is the
right call for a personal control plane and removes an entire class of authorization bugs. Decide it
explicitly now, because reversing it later means touching every table.

### 5.5 Auth provider — *blocking Phase 1*

**Recommendation: Better Auth + GitHub OAuth, one allow-listed email.** Alternative: skip a library
entirely and use a signed cookie behind a single env-var secret — fewer dependencies, but you will
want real sessions the first time you open the dashboard on your phone.

### 5.6 Does catch-all ingress compose with outbound? — *resolved; verify in spike 0.9*

The catch-all decision (§1.2) is an *inbound* optimisation. Sending as any managed address is a
separate authorisation question, and Forward Email requires a concrete alias to authorise the
`From:` — especially on the SMTP path, where credentials are minted per alias via
`POST /v1/domains/{domain}/aliases/{id}/generate-password`.

Forward Email documents that the API-token send path still requires the `from` address to exist as
an alias. Therefore create a concrete provider alias whenever `canSend` is enabled. Spike 0.9 remains
as a regression test of provider behavior, not as the basis for the design. The optional catch-all
continues to serve inbound-only local routes.

### 5.7 Adopt Inbound's payload shape as our public contract? — *decided by spike 0.11*

**Decision: design a smaller MailPiston-owned v1 payload while adopting Inbound's SDK ergonomics.**
Inbound's active payload duplicates parsed and cleaned representations, carries storage-shaped data,
and does not make the Forward Email envelope model as explicit as MailPiston needs. Drop-in payload
compatibility is less valuable than a stable provider-independent contract.

The contract includes event/delivery ids, version, direction, thread/message ids, explicit envelope
sender and recipients, header addresses, safe body representations, attachment metadata/download
URLs, and customer-facing delivery state. It excludes inline attachment bytes, provider session
objects, relay tokens, personal destinations, and personal transport metadata.

The small TypeScript SDK still ships `send`, `reply`, payload types, a runtime guard, and
`verifyWebhook(request, secret)`. Generate types and validation from MailPiston's schema to prevent
drift. The payload is a **public contract** from its first delivery, so version it immediately.

### 5.8 Naming — *decided*

Use **MailPiston** in product prose and `X-Mailpiston-*` for HTTP headers. The execution plan, roadmap,
and public contract now use one product identity.

### 5.9 Which domain is MailPiston itself on? — *decided; one part blocks Phase 6*

Two different domains are in play and conflating them causes real breakage.

| Role | Value | Notes |
| --- | --- | --- |
| **App origin** (dashboard, API, provider ingress) | `https://mailpiston.vercel.app` | In use now. `mailpiston.com` replaces it when the apex is registered. |
| **Relay domain** (opaque reply addresses) | `reply.mailpiston.com` | ⚠️ Not yet registered. Any domain you control DNS for will do — see below. |
| **Managed domains** (customer-facing addresses) | the operator's own domains | Unaffected by either of the above. |

**The app origin is not a free choice at runtime.** Every provider alias MailPiston creates carries
the absolute ingress URL as its recipient, so moving the origin means every alias on every domain now
points at a dead URL. Two consequences:

1. Nothing hard-codes it. `APP_URL` is the single source, read only by `server/core/config.ts`, and
   `inboundIngressUrl()` is the only way to build the ingress address.
2. **Cutting over to `mailpiston.com` is a migration, not a DNS change.** Serve both origins during
   the switch, repoint every alias through the provider interface, and let Phase 10 reconciliation
   confirm zero drift before retiring the old URL. Do it before Phase 11's batch migration, while the
   alias count is small.

**The relay domain is a separate requirement, and it is not a branding one.**
`mailpiston.vercel.app` is a Vercel-owned subdomain: we cannot publish MX records on it, so it can
never accept the relayed replies §19 depends on. Phase 6 therefore needs **a domain whose DNS we
control** — but it does not need a new one, and it does not need to be `mailpiston.com`. A subdomain
of any domain the operator already owns works, because the relay address only ever appears in the
`Reply-To` of a notification sent to the operator's own private mailbox. It is never customer-facing.

So the requirement is, in order of preference:

1. `reply.mailpiston.com`, once the apex is registered — cleanest, and keeps relay traffic off any
   domain that also serves customers;
2. `reply.<any-domain-you-already-own>` — functionally identical, available today;
3. a subdomain of a managed domain — works, but mixes relay tokens into a customer's namespace, so
   prefer 1 or 2.

Phases 1–5 need none of this: `mailpiston.vercel.app` is a complete app origin on its own.

---

## 6. Phase dependency map

```
P0 Spikes
 └─ P1 Foundation
     └─ P2 Provider adapter
         └─ P3 Domains + Addresses
             └─ P4 Inbound
                 ├─ P5 Threads ── P6 Outbound + private relay ◀── USABLE PROTOTYPE CUT LINE
                 ├─ P7 Webhooks ────┤
                 │   └─ P8 Retries ─┤
                 ├─ P9 Events ──────┤
                 └──────────────────┘
                                    └─ P10 Reconciliation
                                        └─ P11 Hardening + migration
```

P5 and P9 can begin independently after P4. P6 depends on P5 because personal relay replies must
join the correct thread. Phase 7 adds the webhook subtype after P6 establishes shared endpoint CRUD;
the usable prototype only needs one hardcoded webhook slice for its end-to-end demonstration.
