# Phase status

Companion to [`PROJECT_ROADMAP.md`](./PROJECT_ROADMAP.md). What is built, what is
deliberately deferred, and what still needs a live domain before it can be
called done.

Last updated: 2026-09-05.

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

## Not started

Phases 4–11 as written in the roadmap. The Phase 4 ingress route exists and is
authenticated and normalising, but it persists nothing yet and says so in its
response (`{ received: true, persisted: false }`).
