# MailPiston security and resilience audit — 2026-09-25

## Outcome

The abuse path that exhausted the provider quota is now bounded at several independent layers. A repeated inbound delivery collapses through idempotency; a personal-forward target, workspace, API caller, and reply-relay token each have separate ceilings; and outbound accounting charges provider-billable recipients rather than HTTP requests. The controls fail closed on paths that spend money or send data.

The test suite covers the highest-risk cases: concurrent replay, oversized bodies with and without `Content-Length`, recipient-weighted quotas, lost webhook schedules, abandoned delivery leases, unbounded response streams, open redirects, and concurrency ceilings.

## Expected personal-inbox flow

One customer message produces one inbound MailPiston row and one constructed notification to each verified personal recipient. The notification is not persisted as another thread message.

| Field | Expected value |
| --- | --- |
| SMTP `To` | The verified personal mailbox |
| Visible `From` | The managed app address, with the customer name as a label |
| `Reply-To` | `reply+<opaque token>@<selected managed domain>` |
| Body context | Clearly labelled original sender and “Received by MailPiston at” managed address |

The selected relay domain may be the same domain as the managed address. The actual `To` and `Reply-To` addresses must not be the same: the former is personal; the latter is a unique, expiring relay capability. Replies received at the relay address are verified against the personal recipient, deduplicated, rate-limited per token, reconstructed without the personal mail headers, and sent to the latest inbound customer address as the managed app address.

## Controls implemented

### Quota and amplification controls

- Database-backed fixed-window limits use row locks and atomic increments.
- Unknown rate-limit buckets default to fail-closed.
- Send and reply quotas count unique `To`, `Cc`, and `Bcc` recipients.
- A message can address at most 50 unique recipients.
- Email-group membership is capped at 25 recipients.
- Default workspace ceilings are 240 total outbound recipients/day, 150 personal forwards/day, and 30 personal forwards/hour to one target.
- A reply-relay token can issue at most 10 distinct customer-facing replies/day by default.
- Authentication endpoints have explicit sign-in and sign-up throttles.
- The Better Auth 1.7.3+ account-schema cleanup is included as migration 0011; `issuer` no longer blocks new OAuth account rows.

### Replay and duplicate-send controls

- Inbound provider delivery retains its existing unique fingerprint.
- Relay replies now claim a fixed-size fingerprint before sending; simultaneous provider retries collapse to one reply.
- API send and reply routes accept `Idempotency-Key`; reuse with the same payload is rejected as an ambiguous replay, while reuse with a different payload is rejected as a key conflict.
- Idempotency state is pruned after seven days.

This is a safety-first idempotency contract: MailPiston does not replay a cached success body. A caller that loses the response receives `409` on retry and should reconcile from the mailbox rather than issue a new send blindly.

### Resource-exhaustion controls

- API request bodies are capped at 2.5 MB by default.
- Provider ingress bodies are capped at 25 MB by default.
- Limits are enforced while streaming, so missing or false `Content-Length` values do not bypass them.
- Webhook error responses are read to at most 16 KB and the remaining stream is cancelled.
- Personal-forward and webhook fan-out use bounded concurrency.
- Cross-tenant recovery, retention, and reconciliation sweeps use bounded concurrency.
- Old rate-limit rows are pruned after two days.

### Retry and self-healing controls

- Webhook retries retain capped exponential backoff with jitter and a finite attempt count.
- Delivery claims use leases, preventing concurrent scheduled/manual attempts from delivering the same row.
- A two-minute recovery sweep finds due pending rows and expired delivery leases, covering a crash between database persistence and scheduler submission.
- Recovery isolates failures so one tenant or destination cannot block the rest.
- Inngest unauthenticated sync is disabled in production, and production refuses to boot without its event and signing keys.

### HTTP and browser controls

- Provider signatures are verified before parsing or rate-limit spend.
- Webhook redirects remain disabled.
- Webhook destinations reject credentials, non-HTTPS URLs, and private/reserved IPv4 and IPv6 answers at configuration and delivery time.
- Sign-in return URLs are restricted to internal paths.
- Responses set HSTS, frame denial, MIME sniffing protection, a strict referrer policy, and a restrictive permissions policy.

## Residual risks and launch gates

### High priority

1. **Transitive dependency advisories.** `bun audit --production` still reports 22 advisories: 8 high, 11 moderate, and 3 low. The remaining exact pins sit under Inngest/Vercel adapters and development tooling (`undici`, `ajv`, `minimatch`, `path-to-regexp`, and `esbuild`). Compatible top-level updates and a same-major `tar@7.5.21` override removed the critical archive advisory. Bun 1.3.14 cannot safely parent-scope the remaining exact pins. Upgrade the owning packages when patched releases land; do not use global overrides that could force incompatible majors into unrelated dependency trees.

2. **Webhook DNS time-of-check/time-of-use.** MailPiston rejects every private DNS answer immediately before delivery, but `fetch` resolves the hostname again. An attacker controlling the configured hostname could change DNS in that narrow interval. Close this with a transport that connects to a validated, pinned address while preserving TLS hostname verification.

3. **Personal-forward durability.** The inbound message remains safe if forwarding fails, but personal forwards do not yet have their own durable delivery row and recovery worker. A process crash after inbound commit and before/during notification can leave the UI copy present without the personal copy. Model forwards as leased deliveries, like webhooks.

### Medium priority

4. **Monthly quota race.** The monthly plan limit counts persisted outbound rows before the next send. Concurrent sends can pass the same remaining-capacity check. The atomic daily egress budget limits the blast radius, but the monthly counter should eventually become an atomic reservation or database-enforced ledger.

5. **Ambiguous provider acceptance.** A crash after the mail provider accepts a message but before MailPiston records `sent` can leave a queued row. Automatic retry could duplicate customer mail, so reconciliation needs a provider idempotency key or a provider-message lookup before retrying.

6. **Distributed auth abuse.** Better Auth's built-in throttle is process-local. Multi-instance deployments should also enforce login and invalid-credential limits at the edge using a shared store/WAF.

7. **Unauthenticated API-key guessing.** API route limits apply after credential resolution, so large volumes of invalid keys can still cause database reads. Add an edge IP/device limit before application authentication without trusting it as the authorization mechanism.

8. **Email-group cap race.** The service checks membership count before insert. Simultaneous additions can exceed 25 unless the cap is moved into a transaction or enforced with a serialized database operation.

## Operational recommendations

- Set the daily limits below the provider's real account allowance and alert at 50%, 75%, and 90% utilization.
- Alert on relay rejections, rate-limit errors, forwarding failures, expired delivery leases, and queued outbound rows older than the provider timeout.
- Rotate a compromised relay by revoking its row; tokens already expire after the configured TTL.
- Require callers to generate a fresh `Idempotency-Key` for each intentional send/reply and retain it until the result has been reconciled.
- Keep endpoint secrets and per-domain provider webhook keys encrypted at rest and rotate `SECRET_ENCRYPTION_KEY` only through the supported previous-key migration that re-encrypts existing values.
- Re-run `bun audit --production`, the full test suite, lint, type checking, boundary checks, and the production build before deployment.
