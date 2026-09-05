# MailPiston + Forward Email — Execution Plan

## 1. Objective

Build **MailPiston** as a lightweight developer-facing email control plane inspired by the best parts of Inbound.new, while delegating all SMTP/MX and mail-delivery heavy lifting to **Forward Email**.

The product should solve the user's actual scaling problem:

- avoid per-domain SaaS pricing;
- support dozens to hundreds of custom domains;
- expose a clean developer API;
- support aliases, endpoints, threading, replies, logs, and delivery events;
- fan inbound mail out to both application webhooks and verified personal inboxes;
- allow replies from a personal inbox without exposing the operator's personal address to the customer;
- remain inexpensive at low traffic;
- scale based primarily on mail volume rather than domain count.

The architectural goal is:

> **Forward Email moves email. MailPiston understands email.**

---

# 2. Final Architecture

```text
                       CUSTOM DOMAINS
             SpeakDiary / GutScribe / etc.
                             │
                             │ MX / SMTP
                             ▼
                  ┌────────────────────┐
                  │   FORWARD EMAIL    │
                  │                    │
                  │ MX                 │
                  │ SMTP               │
                  │ aliases            │
                  │ spam filtering     │
                  │ DKIM/SPF tooling   │
                  │ bounce handling    │
                  │ transport events   │
                  └─────────┬──────────┘
                            │
                       webhook/API
                            │
                            ▼
                  ┌────────────────────┐
                  │    INBOUND LITE    │
                  │      VERCEL        │
                  │                    │
                  │ domains            │
                  │ addresses          │
                  │ endpoints          │
                  │ emails             │
                  │ threads            │
                  │ replies            │
                  │ logs/events        │
                  │ API keys           │
                  │ webhook dispatch   │
                  └─────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
            NEON          CLOUDFLARE R2   VERCEL CRON
          Postgres         attachments     retries/jobs
```

## 2.1 Responsibilities

### Forward Email owns

- MX reception
- SMTP sending
- mail delivery
- alias infrastructure
- spam filtering
- DKIM/SPF/DMARC-related transport configuration
- bounce infrastructure
- transport-provider events

### MailPiston owns

- normalized email model
- normalized domain/address model
- endpoint routing
- API keys
- threading
- reply semantics
- privacy-preserving personal-inbox forwarding and reply relay
- application-level events
- unified logs
- webhook delivery
- retries
- idempotency
- developer-facing REST API
- dashboard

### Vercel owns

- Next.js dashboard
- stateless API execution
- provider webhook ingress
- REST API
- event-driven background jobs and scheduled functions
- normal application deployment


### Inngest owns

- delayed webhook retry orchestration
- event-driven background functions
- periodic provider reconciliation
- scheduled cleanup and maintenance jobs
- durable step execution for background workflows

Inngest does **not** own authoritative email or delivery state. Neon does.

### Neon owns

- durable application state
- rate-limit state
- email metadata
- threads
- endpoint definitions
- event history
- idempotency records
- webhook delivery jobs
- API keys
- reconciliation state

### Cloudflare R2 owns

- attachment/object storage
- optional raw MIME blobs
- optional archived provider payloads

---

# 3. Core Architectural Decision

Do **not** fork the full Inbound codebase as the production foundation.

Use Inbound as a **reference implementation** for:

- developer ergonomics;
- domain/address abstractions;
- emails;
- threads;
- endpoints;
- webhook semantics;
- reply behavior;
- logs/events;
- API surface design.

Then implement only the subset required by MailPiston.

This avoids inheriting:

- billing;
- subscriptions;
- pricing limits;
- SaaS team/org complexity;
- provider-specific infrastructure assumptions;
- unnecessary deployment topology;
- upgrade flows;
- marketing features;
- unrelated AI features.

The application becomes a relatively normal serverless control plane rather than an email server.

---

# 4. Core Domain Model

Use strict OOP boundaries and repository/service abstractions.

## 4.1 Domain

```ts
export interface Domain {
  id: string;
  name: string;
  providerDomainId: string | null;
  status: 'pending' | 'verified' | 'failed' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
}
```

## 4.2 Address

```ts
export interface Address {
  id: string;
  domainId: string;
  localPart: string;
  providerAliasId: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

## 4.3 Endpoint

An `Endpoint` is the user-facing umbrella for a destination. Its type determines its configuration
and security rules: `webhook` for an HTTPS application, `email` for one verified mailbox, or
`email_group` for several independently verified mailboxes. Typed subtype tables are preferred over
an opaque JSON configuration column.

```ts
export interface Endpoint {
  id: string;
  name: string;
  type: 'webhook' | 'email' | 'email_group';
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EndpointWebhookConfig {
  endpointId: string;
  url: string;
  secretCiphertext: string;
}

export interface EndpointEmailRecipient {
  id: string;
  endpointId: string;
  email: string;
  verifiedAt: Date | null;
  enabled: boolean;
}
```

The webhook secret must remain recoverable by the server so it can sign deliveries. Encrypt it at
rest (or derive it from a master key); storing only a hash is insufficient.

## 4.4 AddressEndpoint

```ts
export interface AddressEndpoint {
  addressId: string;
  endpointId: string;
}
```

One endpoint may be bound to several managed addresses, and one address may fan out to several
endpoints of any type. Email recipients must be verified before they receive mail or can originate a
relayed reply.

## 4.4A ReplyRelay

```ts
export interface ReplyRelay {
  id: string;
  tokenHash: string;
  addressId: string;
  threadId: string;
  endpointEmailRecipientId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}
```

The public relay address contains only a random, opaque token, for example
`reply+rr_opaque@reply.mailpiston.com`. It must not encode an email address, thread id, customer id,
or other discoverable state. Store the token hashed and show/store the plaintext only where it is
needed to construct the relay address.

## 4.5 Thread

```ts
export interface Thread {
  id: string;
  subject: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

## 4.6 Email

```ts
export type EmailDirection = 'inbound' | 'outbound';

export type EmailStatus =
  | 'received'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'soft_bounced'
  | 'hard_bounced'
  | 'failed';

export interface Email {
  id: string;
  threadId: string | null;
  addressId: string | null;

  providerMessageId: string | null;
  messageId: string | null;

  direction: EmailDirection;
  status: EmailStatus;

  from: string;
  to: string[];
  cc: string[];

  subject: string | null;
  text: string | null;
  html: string | null;

  inReplyTo: string | null;
  references: string[];

  receivedAt: Date | null;
  sentAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}
```

## 4.7 Event

```ts
export type MailEventType =
  | 'email.received'
  | 'email.queued'
  | 'email.sent'
  | 'email.delivered'
  | 'email.forwarded'
  | 'email.soft_bounced'
  | 'email.hard_bounced'
  | 'email.failed'
  | 'personal_forward.queued'
  | 'personal_forward.delivered'
  | 'personal_forward.failed'
  | 'relay.reply_received'
  | 'relay.reply_rejected'
  | 'relay.reply_sent'
  | 'webhook.queued'
  | 'webhook.delivered'
  | 'webhook.failed';

export interface MailEvent {
  id: string;
  emailId: string | null;
  type: MailEventType;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}
```

## 4.8 EndpointDelivery

```ts
export interface EndpointDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  recipientId: string | null;

  status: 'pending' | 'delivering' | 'delivered' | 'failed';

  attempt: number;
  responseCode: number | null;
  lastError: string | null;

  nextAttemptAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  deliveredAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}
```

---

# 5. Provider Abstraction

Forward Email must be replaceable.

Do not allow controllers, UI components, repositories, thread services, or endpoint dispatchers to know that Forward Email exists.

```ts
export interface MailProvider {
  createDomain(input: CreateDomainInput): Promise<ProviderDomain>;
  verifyDomain(domainId: string): Promise<DomainVerification>;
  deleteDomain(domainId: string): Promise<void>;

  createAlias(input: CreateAliasInput): Promise<ProviderAlias>;
  updateAlias(
    aliasId: string,
    input: UpdateAliasInput
  ): Promise<ProviderAlias>;
  deleteAlias(aliasId: string): Promise<void>;

  send(input: SendEmailInput): Promise<ProviderSendResult>;
  reply(input: ReplyEmailInput): Promise<ProviderSendResult>;

  verifyInboundWebhook(request: Request): Promise<boolean>;

  normalizeInbound(
    payload: unknown
  ): Promise<NormalizedInboundEmail>;

  normalizeDeliveryEvent(
    payload: unknown
  ): Promise<NormalizedMailEvent>;
}
```

Implementations:

```text
MailProvider
├── ForwardEmailProvider      // production
├── MockMailProvider          // tests
├── SesProvider               // possible future
└── CloudflareEmailProvider   // possible future
```

---

# 6. API Surface

Target a compact Inbound-style API.

```text
GET    /v1/domains
POST   /v1/domains
GET    /v1/domains/:id
DELETE /v1/domains/:id

GET    /v1/addresses
POST   /v1/addresses
PATCH  /v1/addresses/:id
DELETE /v1/addresses/:id

GET    /v1/emails
GET    /v1/emails/:id
POST   /v1/emails/send
POST   /v1/emails/:id/reply

GET    /v1/threads
GET    /v1/threads/:id

GET    /v1/endpoints
POST   /v1/endpoints
PATCH  /v1/endpoints/:id
DELETE /v1/endpoints/:id
POST   /v1/endpoints/:id/test
POST   /v1/endpoints/:id/recipients/:recipientId/verify
GET    /v1/addresses/:id/endpoints
POST   /v1/addresses/:id/endpoints
DELETE /v1/addresses/:id/endpoints/:endpointId

GET    /v1/events

GET    /v1/api-keys
POST   /v1/api-keys
DELETE /v1/api-keys/:id
```

Internal/provider routes:

```text
POST /api/providers/forward-email/inbound
POST /api/providers/forward-email/events
POST /api/internal/process-webhooks
POST /api/internal/reconcile-provider
```

---

# 7. Critical Webhook Concerns

The webhook system must explicitly separate four concerns:

```text
AUTHENTICITY
"Is Forward Email really calling us?"

RATE LIMIT
"Is this actor doing too much?"

IDEMPOTENCY
"Have we already processed this event?"

RETRY
"Should this failed downstream delivery run again later?"
```

These are related but **must not be implemented as one system**.

---

# 8. Authenticity

Provider callbacks must be authenticated before any expensive processing.

Example structure:

```ts
export class WebhookVerificationError extends APIError {
  constructor(message = 'Webhook verification failed') {
    super(message, 401, 'WEBHOOK_VERIFICATION_FAILED');
    this.name = 'WebhookVerificationError';
  }
}
```

Provider route:

```ts
export async function POST(request: Request) {
  const provider = mailProviderRegistry.get('forward-email');

  const verified = await provider.verifyInboundWebhook(request);

  if (!verified) {
    throw new WebhookVerificationError();
  }

  // Continue only after authenticity is established.
}
```

Never rely on:

- source IP alone;
- rate limiting alone;
- obscurity of the endpoint URL.

Signature verification is the primary trust mechanism.

---

# 9. Neon-Backed Rate Limiting

The user's existing pattern is valid:

- persistent shared state;
- per-endpoint configuration;
- fail-open / fail-closed semantics;
- structured `RateLimitError`.

The main change is replacing Firestore with Neon/Postgres.

Do **not** implement the rate limiter using a read followed by a separate write without locking.

That pattern creates a race condition:

```text
request A reads count = 29
request B reads count = 29

A allows request #30
B also allows request #30
```

Use a transaction with a row lock.

## 9.1 Schema

For the low-volume workloads expected here, a fixed-window counter is simpler and cheaper than storing one row per request.

```sql
CREATE TABLE rate_limits (
  actor_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,

  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (actor_key, endpoint)
);
```

## 9.2 Actor Model

Do not key only by `userId`.

```ts
export type RateLimitActor =
  | `user:${string}`
  | `apiKey:${string}`
  | `endpoint:${string}`
  | `provider:${string}`
  | `ip:${string}`;
```

Examples:

```text
apiKey:abc123
/v1/emails/send
100/hour
```

```text
provider:forward-email
/api/providers/forward-email/inbound
5000/5min
```

```text
endpoint:ep_123
webhook-delivery
1000/hour
```

## 9.3 Configuration

```ts
interface RateLimitConfig {
  requests: number;
  windowMs: number;
  failOpen: boolean;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  '/v1/emails/send': {
    requests: 100,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/v1/emails/reply': {
    requests: 200,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/v1/domains': {
    requests: 30,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/v1/addresses': {
    requests: 100,
    windowMs: 60 * 60 * 1000,
    failOpen: false,
  },

  '/api/providers/forward-email/inbound': {
    requests: 5000,
    windowMs: 5 * 60 * 1000,
    failOpen: true,
  },

  '/api/providers/forward-email/events': {
    requests: 5000,
    windowMs: 5 * 60 * 1000,
    failOpen: true,
  },
};
```

## 9.4 Neon Transactional Implementation

Assume a `pg`/Neon transaction helper:

```ts
export async function checkRateLimit(
  actor: RateLimitActor,
  endpoint: string
): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}> {
  const config =
    RATE_LIMITS[endpoint] ??
    {
      requests: 100,
      windowMs: 60 * 60 * 1000,
      failOpen: true,
    };

  const now = new Date();
  const nowMs = now.getTime();

  try {
    return await db.transaction(async (tx) => {
      const result = await tx.query<{
        window_started_at: Date;
        request_count: number;
      }>(
        `
        SELECT window_started_at, request_count
        FROM rate_limits
        WHERE actor_key = $1
          AND endpoint = $2
        FOR UPDATE
        `,
        [actor, endpoint]
      );

      if (result.rowCount === 0) {
        await tx.query(
          `
          INSERT INTO rate_limits (
            actor_key,
            endpoint,
            window_started_at,
            request_count
          )
          VALUES ($1, $2, $3, 1)
          `,
          [actor, endpoint, now]
        );

        return {
          allowed: true,
          remaining: config.requests - 1,
          resetAt: nowMs + config.windowMs,
          limit: config.requests,
        };
      }

      const row = result.rows[0];

      const windowStartedAt =
        new Date(row.window_started_at).getTime();

      const expired =
        nowMs - windowStartedAt >= config.windowMs;

      if (expired) {
        await tx.query(
          `
          UPDATE rate_limits
          SET
            window_started_at = $3,
            request_count = 1,
            updated_at = NOW()
          WHERE actor_key = $1
            AND endpoint = $2
          `,
          [actor, endpoint, now]
        );

        return {
          allowed: true,
          remaining: config.requests - 1,
          resetAt: nowMs + config.windowMs,
          limit: config.requests,
        };
      }

      if (row.request_count >= config.requests) {
        throw new RateLimitError(
          windowStartedAt + config.windowMs
        );
      }

      const nextCount = row.request_count + 1;

      await tx.query(
        `
        UPDATE rate_limits
        SET
          request_count = $3,
          updated_at = NOW()
        WHERE actor_key = $1
          AND endpoint = $2
        `,
        [actor, endpoint, nextCount]
      );

      return {
        allowed: true,
        remaining: config.requests - nextCount,
        resetAt: windowStartedAt + config.windowMs,
        limit: config.requests,
      };
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }

    console.error('Rate limit check failed', error);

    if (!config.failOpen) {
      throw new RateLimitError(nowMs + 60_000);
    }

    return {
      allowed: true,
      remaining: config.requests,
      resetAt: nowMs + config.windowMs,
      limit: config.requests,
    };
  }
}
```

## 9.5 Fail-Open vs Fail-Closed Rules

Fail closed for actions that:

- create cost;
- mutate infrastructure;
- send mail;
- create domains;
- create aliases;
- expose privileged API access.

Examples:

```text
/v1/emails/send
/v1/emails/:id/reply
/v1/domains
/v1/addresses
```

Fail open for **already-authenticated provider callbacks** if the limiter itself is temporarily unavailable.

Examples:

```text
/api/providers/forward-email/inbound
/api/providers/forward-email/events
```

Reason:

> Dropping a legitimate inbound email because the limiter database had a transient error is worse than momentarily allowing a burst.

Authenticity must still be verified first.

---

# 10. Idempotency

Rate limiting does not prevent duplicate provider delivery.

Provider webhooks may be retried.

Inbound processing must be idempotent.

## 10.1 Schema

```sql
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Prefer provider IDs where available.

Fallback fingerprint:

```ts
function createInboundFingerprint(input: {
  provider: string;
  providerMessageId?: string | null;
  messageId?: string | null;
  recipient: string;
}): string {
  return [
    input.provider,
    input.providerMessageId ?? '',
    input.messageId ?? '',
    input.recipient,
  ].join(':');
}
```

## 10.2 Atomic Claim

```ts
export async function claimIdempotencyKey(
  key: string,
  source: string
): Promise<boolean> {
  const result = await db.query(
    `
    INSERT INTO idempotency_keys (key, source)
    VALUES ($1, $2)
    ON CONFLICT (key) DO NOTHING
    RETURNING key
    `,
    [key, source]
  );

  return result.rowCount === 1;
}
```

Usage:

```ts
const key = createInboundFingerprint({
  provider: 'forward-email',
  providerMessageId: normalized.providerMessageId,
  messageId: normalized.messageId,
  recipient: normalized.to[0],
});

const claimed = await claimIdempotencyKey(
  key,
  'forward-email.inbound'
);

if (!claimed) {
  return Response.json({
    received: true,
    duplicate: true,
  });
}
```

---

# 11. Inbound Processing Pipeline

Provider webhook receipt must be fast.

Target:

```text
request
  ↓
verify authenticity
  ↓
emergency rate limit
  ↓
normalize provider payload
  ↓
claim idempotency key
  ↓
persist email
  ↓
resolve thread
  ↓
create event
  ↓
create downstream delivery jobs
  ↓
return HTTP 200
```

Never wait for every customer endpoint to successfully respond before acknowledging Forward Email.

The downstream endpoint may be unavailable.

That must not make provider ingestion fail.

Example:

```ts
export class InboundEmailService {
  constructor(
    private readonly emailRepository: EmailRepository,
    private readonly threadService: ThreadService,
    private readonly eventService: EventService,
    private readonly deliveryService: WebhookDeliveryService
  ) {}

  async ingest(
    input: NormalizedInboundEmail
  ): Promise<Email> {
    const email =
      await this.emailRepository.createInbound(input);

    const thread =
      await this.threadService.resolve(email);

    const resolvedEmail =
      thread
        ? await this.emailRepository.attachThread(
            email.id,
            thread.id
          )
        : email;

    const event =
      await this.eventService.create({
        emailId: resolvedEmail.id,
        type: 'email.received',
        metadata: {},
      });

    await this.deliveryService.enqueueForEmail(
      resolvedEmail,
      event
    );

    return resolvedEmail;
  }
}
```

---

# 12. Thread Resolution

Resolve threads conservatively.

Priority:

```text
1. In-Reply-To
2. References
3. known provider/message mapping
4. conservative subject + participant fallback
```

Never merge solely because subjects match.

Example interface:

```ts
export interface ThreadResolver {
  resolve(email: Email): Promise<Thread | null>;
}
```

Implementation:

```ts
export class DefaultThreadResolver
  implements ThreadResolver
{
  constructor(
    private readonly emailRepository: EmailRepository,
    private readonly threadRepository: ThreadRepository
  ) {}

  async resolve(email: Email): Promise<Thread | null> {
    if (email.inReplyTo) {
      const parent =
        await this.emailRepository.findByMessageId(
          email.inReplyTo
        );

      if (parent?.threadId) {
        return this.threadRepository.getById(
          parent.threadId
        );
      }
    }

    for (const reference of email.references) {
      const referenced =
        await this.emailRepository.findByMessageId(
          reference
        );

      if (referenced?.threadId) {
        return this.threadRepository.getById(
          referenced.threadId
        );
      }
    }

    return null;
  }
}
```

---

# 13. Endpoint System

Endpoints are one of the core product features. An endpoint is a typed destination: an HTTPS
application webhook, one verified personal mailbox, or a verified mailbox group. The shared endpoint
model gives the API and dashboard one routing vocabulary; subtype-specific tables and services keep
their delivery and security behavior distinct.

Example:

```text
support@managed-domain.example
  ↓
MailPiston
  ↓
https://app.example/api/mail/support
```

This is illustrative configuration, not a product-specific integration. The same mapping works for
any local part, managed domain, and HTTPS URL.

Normalized payload:

```json
{
  "version": "1",
  "id": "evt_789",
  "type": "email.received",
  "createdAt": "2026-09-05T12:00:00.000Z",
  "data": {
    "id": "em_123",
    "threadId": "th_456",
    "direction": "inbound",
    "envelope": {
      "from": "customer@example.com",
      "recipients": ["support@managed-domain.example"]
    },
    "from": {
      "name": "Customer",
      "email": "customer@example.com"
    },
    "to": [
      "support@managed-domain.example"
    ],
    "subject": "Transcription is not working",
    "text": "Hi...",
    "html": "<p>Hi...</p>",
    "attachments": []
  }
}
```

Attachment entries contain metadata and authenticated download URLs, not inline bytes. Provider
session objects, raw MIME, personal destinations, relay tokens, and personal transport metadata are
never part of this public contract.

Every webhook endpoint receives the same provider-independent payload. An address may simultaneously
have zero or more endpoints of any type. Inbound persistence is mandatory and happens before any
fan-out path.

---

# 14. Downstream Webhook Signing

Each webhook endpoint has its own signing secret. The secret is shown once and stored encrypted (or
derived from a master key), because the delivery service must recover it to generate signatures. A
hash-only scheme works for verification of submitted values but cannot sign an outbound webhook.

Example:

```ts
import crypto from 'node:crypto';

export function signWebhookPayload(
  timestamp: string,
  payload: string,
  secret: string
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
}
```

Request headers:

```text
X-Mailpiston-Event: email.received
X-Mailpiston-Delivery-Id: epd_123
X-Mailpiston-Timestamp: 1788541200
X-Mailpiston-Signature: sha256=...
```

Verify against the exact raw request body with a constant-time comparison and reject timestamps
outside the configured replay window.

---

# 15. Retry System

Retry scheduling is **not** rate limiting.

A rate limiter answers:

> "May this operation happen?"

A retry system answers:

> "When should this failed operation happen again?"

Use **Inngest** for scheduling and orchestration.

Use **Neon** as the durable source of truth for delivery state.

This gives the system a clean split:

```text
Neon
"What is the current delivery state?"

Inngest
"When and how should background work run?"
```

## 15.1 Retry Schedule

```text
attempt 1   immediately
attempt 2   +30 sec
attempt 3   +2 min
attempt 4   +10 min
attempt 5   +1 hour
attempt 6   +6 hours
attempt 7   +24 hours
```

Add jitter where practical.

## 15.2 Emit a Failure Event

When an endpoint delivery fails, persist the failure first, then emit an Inngest event.

```ts
await webhookDeliveryRepository.markFailed({
  deliveryId,
  responseCode,
  errorMessage,
  attempt,
  nextAttemptAt,
});

await inngest.send({
  name: 'email/webhook.delivery.failed',
  data: {
    deliveryId,
    attempt,
  },
});
```

The database write comes first so Inngest is never the only place where retry state exists.

## 15.3 Inngest Retry Function

```ts
export const retryWebhookDelivery = inngest.createFunction(
  {
    id: 'retry-webhook-delivery',
    retries: 0,
  },
  { event: 'email/webhook.delivery.failed' },
  async ({ event, step }) => {
    const delivery =
      await webhookDeliveryRepository.getById(
        event.data.deliveryId
      );

    if (!delivery) {
      return { skipped: true, reason: 'missing-delivery' };
    }

    if (delivery.status === 'delivered') {
      return { skipped: true, reason: 'already-delivered' };
    }

    const delay = getRetryDelay(delivery.attempt);

    await step.sleep('wait-before-retry', delay);

    return step.run('deliver-webhook', async () => {
      return webhookDispatcher.deliver(delivery.id);
    });
  }
);
```

Recommended rule:

> Inngest controls the timing. Neon controls the state.

## 15.4 Retry Delay Helper

```ts
const RETRY_DELAYS_MS = [
  0,
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

export function getRetryDelay(attempt: number): string {
  const index = Math.min(
    Math.max(attempt, 0),
    RETRY_DELAYS_MS.length - 1
  );

  const ms = RETRY_DELAYS_MS[index];

  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.ceil(ms / 60_000)}m`;
  return `${Math.ceil(ms / 3_600_000)}h`;
}
```

## 15.5 Delivery Service Must Be Idempotent

Inngest may retry function execution, events may be emitted more than once, and a developer may manually retry a failed delivery.

The delivery layer therefore must check current Neon state before sending.

```ts
export class WebhookDispatcher {
  async deliver(deliveryId: string) {
    const delivery =
      await this.deliveryRepository.claimForDelivery(
        deliveryId
      );

    if (!delivery) {
      return {
        skipped: true,
        reason: 'already-claimed-or-complete',
      };
    }

    try {
      const response = await this.httpClient.post(
        delivery.endpoint.url,
        delivery.payload,
        {
          headers: buildSignedHeaders(delivery),
        }
      );

      await this.deliveryRepository.markDelivered({
        deliveryId,
        responseCode: response.status,
      });

      return { delivered: true };
    } catch (error) {
      await this.deliveryRepository.recordAttemptFailure({
        deliveryId,
        error,
      });

      throw error;
    }
  }
}
```

Use row-level locking or an atomic state transition such as:

```sql
UPDATE webhook_deliveries
SET
  status = 'delivering',
  updated_at = NOW()
WHERE id = $1
  AND status IN ('pending', 'failed')
RETURNING *;
```

This prevents two Inngest executions from delivering the same webhook concurrently.

## 15.6 Final Failure State

After the configured maximum attempt count:

```text
status = 'failed'
nextAttemptAt = NULL
```

Do not schedule another Inngest event.

The dashboard should allow:

- inspect failure;
- view response code;
- view last error;
- view attempt history;
- manually retry.

## 15.7 Inngest vs Polling

Do **not** poll Neon every minute in v1.

Do not introduce:

- Redis;
- BullMQ;
- a dedicated worker VPS;
- Vercel Cron for retry scanning;
- an always-on queue processor.

Inngest should handle delayed execution directly.

Neon remains the durable audit trail and recovery source of truth.

# 16. Error Model

Reuse the user's current structured API error pattern.

```ts
export class APIError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = 'INTERNAL_ERROR'
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export class ValidationError extends APIError {
  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class AuthError extends APIError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends APIError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends APIError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends APIError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends APIError {
  constructor(public readonly resetAt: number) {
    super(
      'Rate limit exceeded',
      429,
      'RATE_LIMIT_EXCEEDED'
    );

    this.name = 'RateLimitError';
  }
}

export class ExternalAPIError extends APIError {
  constructor(
    message: string,
    public readonly provider: string
  ) {
    super(
      message,
      502,
      'EXTERNAL_API_ERROR'
    );

    this.name = 'ExternalAPIError';
  }
}

export class ProviderTimeoutError extends APIError {
  constructor(provider: string) {
    super(
      `${provider} timed out`,
      504,
      'PROVIDER_TIMEOUT'
    );

    this.name = 'ProviderTimeoutError';
  }
}

export class WebhookVerificationError
  extends APIError {
  constructor(
    message = 'Webhook verification failed'
  ) {
    super(
      message,
      401,
      'WEBHOOK_VERIFICATION_FAILED'
    );

    this.name = 'WebhookVerificationError';
  }
}
```

Formatter:

```ts
export function formatErrorResponse(
  error: unknown
) {
  if (error instanceof APIError) {
    return {
      error: {
        code: error.code,
        message: error.message,

        ...(error instanceof RateLimitError && {
          resetAt: error.resetAt,
        }),

        ...(error instanceof ExternalAPIError && {
          provider: error.provider,
        }),

        ...(error instanceof ValidationError && {
          details: error.details,
        }),
      },
    };
  }

  console.error('Unexpected error:', error);

  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  };
}
```

---

# 17. Neon Database Layout

Suggested tables:

```text
domains
addresses
endpoints
address_endpoints
endpoint_webhook_configs
endpoint_email_recipients
reply_relays
endpoint_deliveries

threads
emails
email_attachments

mail_events

api_keys

rate_limits
idempotency_keys

provider_reconciliation_runs
provider_reconciliation_items
```

Use migrations.

Recommended ORM:

- Drizzle ORM if desired;
- raw SQL for concurrency-sensitive primitives.

Use raw SQL or strongly controlled repository methods for:

- `FOR UPDATE`;
- `SKIP LOCKED`;
- idempotency claims;
- rate-limit mutations;
- delivery-job claiming.

---

# 18. Attachments

Store attachment metadata in Neon.

Store attachment blobs in R2.

Example:

```ts
export interface EmailAttachment {
  id: string;
  emailId: string;

  filename: string;
  contentType: string;
  sizeBytes: number;

  storageKey: string;

  createdAt: Date;
}
```

Never store large binary attachments directly in Postgres.

---

# 19. Personal Inbox Forwarding

MailPiston should not require the operator to live in its dashboard. A verified personal mailbox may
be used as the human interface while MailPiston remains the source of truth and the only public mail
identity.

This capability applies uniformly to **every address on every domain managed by MailPiston**. Domain
names, local parts, application names, HTTP URLs, and personal destinations are configuration data;
there is no SpeakDiary-specific routing or code. Any named domain below is illustrative only.

The supported workflow is:

```text
customer <customer@example.com>
  → managed-address@customer-domain.com
  → Forward Email
  → MailPiston durable ingress
       ├→ configured application HTTPS endpoint (optional)
       ├→ MailPiston Inbox and thread
       └→ verified personal inbox

personal inbox replies
  → reply+<opaque-token>@reply.mailpiston.com
  → MailPiston verifies token + personal sender
  → MailPiston creates a new customer-facing message
  → Forward Email sends From: managed-address@customer-domain.com
  → customer receives the reply
  → configured application endpoint receives the outbound/thread event (optional)
```

## 19.1 Forward notification construction

Do not blindly redirect or resend the original raw MIME to the personal address. Construct an
internal notification message with:

```text
From: "Customer Name via Managed Address" <managed-address@customer-domain.com>
To: operator-personal@example.com
Reply-To: reply+<opaque-token>@reply.mailpiston.com
Subject: original subject
```

Include the original display name, sender address, recipients, body, and safe attachments in the
notification. Treat this as an internal delivery, not as a customer-facing outbound email in the
thread.

## 19.2 Relayed reply construction

When mail arrives at a reply relay address:

1. Resolve the opaque token using a constant-time-safe hashed lookup strategy.
2. Require the envelope sender to match the verified endpoint recipient bound to that token.
3. Reject expired, revoked, unknown, or wrong-sender relays without sending customer mail.
4. Extract the new reply content and attachments. Do not reuse the personal message's raw MIME.
5. Construct a fresh outbound email with `From: managed-address@customer-domain.com`, the customer as recipient,
   and the customer-facing `In-Reply-To` and `References` chain.
6. Generate a new customer-facing `Message-ID`; never expose the personal provider's `Message-ID`,
   `Return-Path`, `Received`, `Sender`, or authentication headers.
7. Persist it in the existing MailPiston thread, send through Forward Email, and emit outbound events
   to configured HTTPS endpoints.

The public outbound endpoint event contains the managed address and customer-facing message only.
It must not contain the personal forwarding address, relay token, or personal inbound transport
metadata. Those details are restricted to the operator's private audit log.

Transport/header privacy is enforceable. Body privacy is partly a user-content problem: an operator
can still type a personal address or include a personal signature. Strip common quoted-header blocks
and signatures on a best-effort basis, show a warning in setup, and never claim that arbitrary body
content can be made leak-proof automatically.

## 19.3 Fan-out and failure rules

- Webhook and email endpoints are independent and may both be enabled.
- A failure delivering to a personal inbox or webhook endpoint never rejects already-durable provider
  ingress.
- Each fan-out delivery has its own status, attempts, and audit events.
- Prevent loops using relay-specific headers, an `Auto-Submitted` policy, hop counting, and
  idempotency keys.
- The default relay action is **reply to the original external sender only**, not reply-all. Add
  explicit reply-all semantics later only with a reviewed participant policy.
- Email endpoint recipients must be independently verified and revocable.
- Direct replies from the personal mailbox to the customer are outside MailPiston and may expose the
  personal identity; the user must reply to the generated relay address.
- Every constructed personal notification is an outbound message, and every relayed customer reply
  is another outbound message. Count both against provider limits and show them separately from
  customer-facing outbound mail in usage reporting.

MailPiston continues to provide:

- searchable mail history;
- API;
- thread view;
- reply support;
- event timeline;
- endpoint delivery status.

Application-controlled forwarding is the default. Do not configure the personal email address as a
second Forward Email alias recipient: MailPiston needs to create the safe `Reply-To` relay, record the
delivery, and prevent personal identity leakage.

`reply.mailpiston.com` represents a MailPiston-owned, provider-verified relay domain with a catch-all
alias routed only to MailPiston ingress. It is shared infrastructure for all managed domains; each
opaque token resolves the correct managed address, thread, and verified email endpoint recipient.

---

# 20. Dashboard

Keep the interface intentionally small.

Navigation:

```text
Overview
Inbox
Sent
Threads
Logs

Domains
Addresses
Endpoints

API Keys
Settings
```

Avoid:

- billing;
- plans;
- organizations;
- seats;
- campaigns;
- CRM;
- AI assistants;
- complex permissions;
- unnecessary onboarding.

The system is a focused developer utility.

---

# 21. Project Structure

```text
src/
├── app/
│   ├── api/
│   │   ├── v1/
│   │   ├── providers/
│   │   └── internal/
│   └── dashboard/
│
├── core/
│   ├── auth/
│   ├── errors/
│   ├── rate-limit/
│   ├── idempotency/
│   ├── crypto/
│   └── validation/
│
├── mail/
│   ├── domains/
│   ├── addresses/
│   ├── emails/
│   ├── threads/
│   ├── events/
│   ├── endpoints/
│   └── forwarding/
│
├── providers/
│   ├── MailProvider.ts
│   └── forward-email/
│       ├── ForwardEmailProvider.ts
│       ├── ForwardEmailClient.ts
│       ├── ForwardEmailNormalizer.ts
│       └── ForwardEmailVerifier.ts
│
├── repositories/
│   ├── DomainRepository.ts
│   ├── AddressRepository.ts
│   ├── EmailRepository.ts
│   ├── ThreadRepository.ts
│   ├── EventRepository.ts
│   ├── EndpointRepository.ts
│   ├── EndpointDeliveryRepository.ts
│   ├── ReplyRelayRepository.ts
│   └── ApiKeyRepository.ts
│
├── db/
│   ├── client.ts
│   ├── schema/
│   └── migrations/
│
├── jobs/
│   └── inngest/
│       ├── client.ts
│       ├── retryWebhookDelivery.ts
│       ├── reconcileForwardEmail.ts
│       └── maintenance.ts
│
├── storage/
│   └── R2Storage.ts
│
└── theme/
    └── theme.ts
```

Strict rules:

- controllers/routes orchestrate only;
- business logic belongs in services;
- persistence belongs in repositories;
- provider code belongs behind `MailProvider`;
- UI uses reusable components;
- all spacing, colors, typography, radii, shadows, and layout tokens come from one global theme source.

---

# 22. Phased Execution

## Phase 0 — Audit Inbound

Completed on 2026-09-05. See `docs/spikes/inbound-source-read.md` for the pinned checkout, inspected
paths, adopt/adapt/reject matrix, and decisions that feed the schema.

Document:

```text
domains
addresses
emails
threads
endpoints
webhook signing
webhook retries
send
reply
logs/events
attachments
API design
```

For each:

```text
What does Inbound expose?
What is elegant?
What is unnecessary?
What assumptions depend on its existing infrastructure?
What should MailPiston reproduce?
```

The outcome is a typed endpoint umbrella with many-to-many address bindings, a MailPiston-owned
webhook contract, one inbound/outbound email table, header-only threading, delivery leases, and a
privacy relay that deliberately replaces Inbound's direct `Reply-To` forwarding behavior.

Do not begin by copying the whole repo.

---

## Phase 1 — Scaffold

Build:

- Next.js;
- TypeScript;
- Neon connection;
- migrations;
- repository abstractions;
- error model;
- global theme;
- environment config;
- basic dashboard shell.

Acceptance:

- Vercel deploy succeeds;
- Neon connectivity works;
- migrations run cleanly.

---

## Phase 2 — Forward Email Provider

Implement:

```text
ForwardEmailClient
ForwardEmailProvider
ForwardEmailNormalizer
ForwardEmailVerifier
```

Acceptance:

- create domain;
- verify domain;
- create alias;
- delete alias;
- send mail;
- normalize inbound payload;
- verify webhook.

---

## Phase 3 — Domains + Addresses

Implement:

- domains;
- aliases/addresses;
- provider mapping;
- status;
- dashboard;
- API.

Acceptance:

- add test domain;
- create `support@`;
- create `hello@`;
- remove alias;
- verify local/provider state matches.

---

## Phase 4 — Inbound Email

Implement:

- provider webhook;
- signature verification;
- provider rate limit;
- idempotency;
- normalized persistence;
- email viewer.

Acceptance:

- send external email to alias;
- one local email record appears;
- repeated provider webhook produces no duplicate.

---

## Phase 5 — Threads

Implement:

- Message-ID;
- In-Reply-To;
- References;
- thread resolution;
- thread dashboard.

Acceptance:

- inbound → reply → inbound reply remains one thread.

---

## Phase 6 — Outbound + Replies

Implement:

```text
POST /v1/emails/send
POST /v1/emails/:id/reply
```

Acceptance:

- send new message;
- reply to inbound email;
- outgoing messages appear in thread;
- events show status changes.

Also implement personal-inbox relay replies:

- shared endpoint CRUD and many-to-many address bindings, initially enabling `email` and
  `email_group` endpoint types;
- verified email/email-group endpoint recipients and per-address endpoint bindings;
- application-controlled forward notifications;
- opaque reply addresses on a MailPiston-owned relay domain;
- sender authorization, token expiry/revocation, and loop prevention;
- reconstruction of clean customer-facing headers;
- persistence in the original thread;
- outbound events to any configured webhook endpoints.

Acceptance:

- mail to any configured managed address appears in MailPiston and its verified personal inbox;
- replying from the personal inbox sends to the original customer as that managed address;
- the customer-visible source, return path, `Message-ID`, and transport headers contain no personal
  address;
- the relayed reply appears in the same MailPiston thread and emits an event to every HTTP endpoint
  configured for that address;
- a reply from any address other than the verified endpoint recipient is rejected;
- revoking a relay prevents subsequent sends.

---

## Phase 7 — Webhook Endpoints

Implement:

- webhook endpoint subtype and test action (shared endpoint CRUD and per-address mapping begin in Phase 6);
- signing;
- delivery log;
- delivery claim/lease state and pending failures for the Phase 8 retry worker;
- HTTPS-only URL validation at configuration and delivery time, including DNS-result checks against
  private, loopback, link-local, and metadata-service addresses.

Acceptance:

- mail to a configured managed address calls its configured webhook endpoint;
- signature validates;
- endpoint failure leaves durable pending delivery state without failing provider ingress.

---

## Phase 8 — Inngest Retry Engine

Implement:

- Inngest event emission on delivery failure;
- delayed retry orchestration via `step.sleep`;
- Neon-backed delivery state;
- atomic claim-before-delivery;
- retry schedule;
- jitter;
- dead/final failure state;
- manual retry support.

Acceptance:

- 500 response emits a retry event;
- Inngest waits for the configured retry delay;
- successful retry stops future attempts;
- duplicate Inngest executions cannot send the same delivery concurrently;
- final failure remains inspectable in Neon;
- manual retry works without bypassing idempotency safeguards.

---

## Phase 9 — Logs/Event Timeline

Build one event stream for:

```text
received
queued
sent
delivered
forwarded
soft bounced
hard bounced
failed
webhook queued
webhook delivered
webhook failed
```

Acceptance:

- every message has a clear audit trail.

---

## Phase 10 — Provider Reconciliation

Periodically compare:

```text
MailPiston domains
vs
Forward Email domains
```

and:

```text
MailPiston addresses
vs
Forward Email aliases
```

Schedule every ~6 hours with an Inngest cron function.

```ts
export const reconcileForwardEmail = inngest.createFunction(
  { id: 'reconcile-forward-email' },
  { cron: '0 */6 * * *' },
  async ({ step }) => {
    return step.run(
      'reconcile-provider-state',
      async () =>
        providerReconciliationService.run()
    );
  }
);
```

Initially:

- detect drift;
- display drift;
- never auto-repair silently.

Acceptance:

- manually removing provider alias shows reconciliation warning.

---

# 23. Migration Strategy

Move domains gradually.

```text
Batch 1: 2 test domains
Batch 2: 3 low-risk apps
Batch 3: 10 domains
Batch 4: 15 domains
Batch 5: remainder
```

For every batch test:

```text
MX
SPF
DKIM
DMARC
inbound
outbound
reply
threading
personal forwarding
endpoint delivery
bounce event
logs
```

---

# 24. Security Requirements

Must-have:

- provider webhook signature verification;
- API key hashing;
- endpoint-secret encryption or master-key derivation strategy;
- HMAC downstream webhook signatures;
- request timestamp tolerance;
- idempotency;
- SQL parameterization;
- rate limiting;
- encrypted environment secrets;
- attachment access controls;
- verified email endpoint recipients;
- opaque, hashed, revocable reply-relay tokens;
- strict relay sender matching;
- removal of personal transport headers when reconstructing outbound replies;
- relay loop and auto-responder protection;
- internal cron secret;
- no provider credentials exposed to browser;
- audit log for privileged mutations.

---

# 25. Cost Target

Initial intended infrastructure:

```text
Forward Email Enhanced      ~$3/mo
Vercel                      ~$0 initially
Neon                        ~$0 initially
Inngest                     ~$0 initially
Cloudflare DNS              $0
R2                          ~$0 initially
----------------------------------------
Target                      ~$3/mo initially
```

The key invariant:

```text
2 domains     ~same
10 domains    ~same
50 domains    ~same
100 domains   ~same
```

until actual mail/storage/compute usage grows.

Cost must scale primarily with usage, not domain count.

---

# 26. Conditions for Leaving Vercel

Do not introduce Coolify/Hetzner prematurely.

Move only if there is a demonstrated need for:

- long-running background processes;
- high-frequency queues;
- persistent sockets;
- worker workloads that become expensive on serverless;
- Vercel duration/runtime limits;
- materially cheaper always-on compute at sustained volume.

If migration becomes necessary:

```text
Forward Email
      ↓
MailPiston
      ↓
Coolify
      ↓
Hetzner
```

The application architecture should make this straightforward because Neon and R2 remain external.

---

# 27. Final Engineering Principles

1. **Forward Email is transport, not product state.**
2. **MailPiston owns the developer semantics.**
3. **Neon is the durable source of truth.**
4. **Vercel functions remain stateless.**
5. **Provider code stays behind an adapter.**
6. **Authenticity, rate limiting, idempotency, and retries are separate systems.**
7. **Verified provider callbacks fail open on rate-limiter outages; privileged mutation routes fail closed.**
8. **Provider ingestion acknowledges quickly.**
9. **Downstream endpoint failure never makes provider ingestion fail.**
10. **Threading is conservative.**
11. **Use Inngest for background orchestration; do not add Redis, BullMQ, dedicated workers, or VPS queues until evidence requires them.**
12. **Do not scale cost by domain count.**
13. **Keep the application small enough that one developer can understand the entire control plane.**

---

# 28. Canonical Mental Model

```text
FORWARD EMAIL
"Move the message."

INBOUND LITE
"Understand and expose the message."

NEON
"Remember the message."

INNGEST
"Run the background work at the right time."

R2
"Store the heavy parts."

VERCEL
"Run the application."

CLOUDFLARE
"Handle DNS / edge / object storage support."
```

That is the target system.
