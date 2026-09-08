# Manual testing commands

Copy-paste commands for exercising MailPiston by hand — against Forward Email,
and against a running MailPiston instance.

Companion to [`phase-status.md`](./phase-status.md), which records what is built
and what still needs a live delivery to confirm.

Set these once per shell (Git Bash, or any POSIX shell):

```bash
FE_TOKEN='your-forward-email-api-token'      # My Account → Security
FE_WEBHOOK_KEY='your-domain-webhook-key'     # per-DOMAIN, not the API token
DOMAIN='your-test-domain.example'
APP='https://mailpiston.com'          # or http://localhost:3000
```

---

## 1. Forward Email

Authentication is HTTP Basic with **the API token as the username and an empty
password**. The trailing colon in `-u TOKEN:` *is* the empty password — leaving
it off makes curl prompt for one interactively and hang.

### Does the token work?

```bash
curl -sS https://api.forwardemail.net/v1/account -u "$FE_TOKEN:"
```

Returns your account object. A `401` means the token is wrong; a `402` or a
message about plans means the account is not on Enhanced Protection, which is
the tier that carries Developer API access.

### List domains

```bash
curl -sS https://api.forwardemail.net/v1/domains -u "$FE_TOKEN:"
```

### One domain, with its DNS verification state

```bash
curl -sS "https://api.forwardemail.net/v1/domains/$DOMAIN" -u "$FE_TOKEN:"
```

The `has_mx_record`, `has_txt_record`, `has_dkim_record`,
`has_return_path_record` and `has_dmarc_record` booleans are what
`DomainService.verify()` reads.

### Ask Forward Email to re-check DNS

```bash
curl -sS "https://api.forwardemail.net/v1/domains/$DOMAIN/verify-records" \
  -u "$FE_TOKEN:"
```

### List the aliases on a domain

```bash
curl -sS "https://api.forwardemail.net/v1/domains/$DOMAIN/aliases" -u "$FE_TOKEN:"
```

Every alias MailPiston creates has our ingress URL as its recipient. If a
`recipients` array here points anywhere else, something has drifted — that is
what Phase 10 reconciliation is for.

### Outbound quota (Phase 6)

```bash
curl -sS https://api.forwardemail.net/v1/emails/limit -u "$FE_TOKEN:"
```

Returns the provider's own daily `count` and `limit`. The monthly allowance is
advertised separately and must not be derived from these.

---

## 2. MailPiston

### Health

```bash
curl -sS "$APP/api/v1/health"
```

### Fire a signed inbound delivery

The signature covers the **raw request bytes**. Anything that parses and
re-serialises the body between signing and sending produces a different byte
string and will never match, so the script below serialises exactly once:

```bash
bun run post:inbound plain-text "support@$DOMAIN"
```

Fixtures: `plain-text`, `html`, `reply`, `bcc-only`, `with-attachment`.

Against the deployed instance rather than localhost:

```bash
APP_URL="$APP" FORWARD_EMAIL_WEBHOOK_KEY="$FE_WEBHOOK_KEY" \
  bun run post:inbound plain-text "support@$DOMAIN"
```

### The same thing as raw curl

If you want to see every moving part, or you are not on a machine with the repo:

```bash
BODY=$(cat <<JSON
{"messageId":"<manual-001@example.net>","subject":"Manual test","date":"2026-09-06T10:00:00.000Z","text":"Sent by hand.","from":{"value":[{"address":"customer@example.net","name":"A Customer"}]},"to":{"value":[{"address":"support@$DOMAIN","name":""}]},"recipients":["support@$DOMAIN"],"attachments":[],"headerLines":[],"session":{"sender":"customer@example.net","recipient":"support@$DOMAIN","arrivalDate":"2026-09-06T10:00:00.000Z","remoteAddress":"203.0.113.10"}}
JSON
)

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$FE_WEBHOOK_KEY" -hex | sed 's/^.* //')

curl -sS -X POST "$APP/api/providers/forward-email/inbound" \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Signature: $SIG" \
  --data-raw "$BODY"
```

`printf '%s'` rather than `echo` matters — `echo` appends a newline, which
changes the bytes and therefore the signature.

### The four outcomes worth checking

| Test | Command | Expected |
| --- | --- | --- |
| Capture | `bun run post:inbound plain-text "support@$DOMAIN"` | `{"status":"captured","emailId":"em_…"}`, appears in Inbox |
| Duplicate | run the same command twice with `PIN_MESSAGE_ID=1` | second is `{"status":"duplicate"}`, no second row |
| Unknown recipient | `bun run post:inbound plain-text "nobody@$DOMAIN"` | `{"status":"rejected","reason":"unknown_recipient"}`, nothing stored |
| Tampered body | send the curl above with one character changed after signing | `401`, nothing written |

The tampered-body case is the important one. It is the only failure that must
**not** return `200` — every other downstream error returns 200 so the provider
stops retrying something that will keep failing the same way.

### Attachments round-trip

```bash
bun run post:inbound with-attachment "support@$DOMAIN"
```

Open the message in the Inbox and download the attachment. Locally the bytes
stream from `.mailpiston-storage/`; with R2 configured the route redirects to a
5-minute presigned URL. Either way the caller is authenticated first.

### Read the API directly

```bash
curl -sS "$APP/api/v1/emails?direction=inbound&limit=10" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

---

## 3. Before a production deploy

Two things that are not code and will break the deployment if skipped:

1. **Run the migration.** `0001_heavy_mister_sinister.sql` adds
   `emails.fingerprint` and its unique index. Without it every inbound delivery
   fails on an unknown column.

   ```bash
   DATABASE_URL='<production neon url>' bun run db:migrate
   ```

2. **Set the new environment variables in Vercel.** `LOCAL_STORAGE_DIR` is
   development-only, but the R2 four are not optional in production —
   `getStorage()` refuses to fall back to a filesystem driver there, because a
   serverless filesystem is per-instance and ephemeral and losing attachments
   would look like data loss rather than misconfiguration.

   `MAIL_PROVIDER=mock` is also refused in production: the mock accepts unsigned
   inbound webhooks, and that must not be reachable by getting one env var wrong.

---

## 4. Per-domain webhook keys

Forward Email issues **one webhook key per domain**, so `FORWARD_EMAIL_WEBHOOK_KEY`
verifies exactly one of them. Keys for additional domains are stored encrypted
in `domain_webhook_keys` and set from the Domains page, or over the API:

```bash
curl -sS -X PUT "$APP/api/v1/domains/$DOMAIN_ID/webhook-key" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MAILPISTON_API_KEY" \
  -d "{\"webhookKey\":\"$FE_WEBHOOK_KEY\"}"
```

Remove one, falling back to the environment variable:

```bash
curl -sS -X DELETE "$APP/api/v1/domains/$DOMAIN_ID/webhook-key" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

There is no `GET`. The plaintext is needed only on the server to recompute an
HMAC, and a route that read it back would exist only to be misused — the
Domains page shows `stored` or `using env fallback` instead.

An inbound request is verified against **every** candidate key. Picking one key
by reading the recipient domain out of the body would be faster, but it means
parsing a body before it has been authenticated, and that inverts the ordering
the ingress wrapper exists to guarantee. A single-tenant control plane has tens
of domains; an HMAC costs microseconds.

Rotating a key takes effect within 60 seconds on its own, or immediately for
whoever saved it — the resolver caches, because it runs before authentication
and must not let an unauthenticated caller drive one query per request.

---

## 5. Webhook endpoints (Phase 7)

### Create one, and keep the secret

```bash
curl -sS -X POST "$APP/api/v1/endpoints" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MAILPISTON_API_KEY" \
  -d '{"name":"My app","type":"webhook","url":"https://app.example/api/mail"}'
```

The `secret` in that response is the only time it is ever returned. It is stored
encrypted rather than hashed — the server has to recover it to *sign* every
delivery — so "shown once" is the only thing between an encrypted column and a
read endpoint that hands it back. Lost it? Rotate:

```bash
curl -sS -X POST "$APP/api/v1/endpoints/$ENDPOINT_ID/rotate-secret" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

Rotation takes effect immediately and there is no grace period. Deliveries
between the rotation and your redeploy will fail verification, which is the
correct trade: a secret being rotated because it leaked has to stop working the
moment it is rotated.

### Bind it to an address and send a test

```bash
curl -sS -X POST "$APP/api/v1/addresses/$ADDRESS_ID/endpoints" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MAILPISTON_API_KEY" \
  -d "{\"endpointId\":\"$ENDPOINT_ID\"}"

curl -sS -X POST "$APP/api/v1/endpoints/$ENDPOINT_ID/test" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

The test reports what the receiver said and writes no delivery row — the log is
the audit trail of real mail, and a test entry in it would be indistinguishable
from one.

### Read the delivery log

```bash
curl -sS "$APP/api/v1/endpoints/$ENDPOINT_ID/deliveries?limit=20" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

### Verify a delivery by hand

The signature is over `timestamp + "." + body`, so both header and body are
needed:

```bash
BODY='<the exact raw bytes you received>'
TS='<X-Mailpiston-Timestamp>'

printf '%s.%s' "$TS" "$BODY" \
  | openssl dgst -sha256 -hmac "$ENDPOINT_SECRET" -hex | sed 's/^.* /sha256=/'
```

Compare that against `X-Mailpiston-Signature`. In an application, use
`verifyWebhook` from `@mailpiston/sdk` instead — it reads the body once, as
text, which is the part people get wrong: parsing and re-serialising the JSON
changes key order and number formatting, and the signature will never match.

### The four outcomes worth checking

| Test | How | Expected |
| --- | --- | --- |
| Delivery | send mail to a bound address | receiver gets a signed POST within seconds; delivery row `delivered` with the response code |
| Stale timestamp | replay a captured delivery an hour later | receiver's `verifyWebhook` throws `Timestamp outside the replay window` |
| Failing receiver | make the receiver answer 500 | delivery row stays `pending` with `500` recorded — **and the mail provider still gets a 200** |
| SSRF | configure `https://169.254.169.254/` | refused at creation; if a hostname is repointed there afterwards, the delivery fails with `private address` and nothing is sent |

The failing-receiver case is the one to check most carefully. The message is
already durable when delivery runs, so a non-200 back to the mail provider would
make it retry a delivery we already hold — the retry deduplicates, and the
operator simply never sees the mail.

Retries are Phase 8. Until then a failed delivery sits `pending` and due, which
is the handover: nothing is lost, nothing is retried yet.

### Local development against an HTTP receiver

`WEBHOOK_ALLOW_INSECURE_TARGETS=true` allows `http://` and loopback targets so a
local receiver can be used. It is refused outright when `NODE_ENV=production` —
a flag that could disable the SSRF guard there would be the entire
vulnerability.

---

## 6. Retries (Phase 8)

Retries need the Inngest dev server running alongside `next dev`. It discovers
functions by polling the app's own ingress:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Its dashboard is at <http://localhost:8288> — event stream on one tab, function
runs on the other. Neither `INNGEST_EVENT_KEY` nor `INNGEST_SIGNING_KEY` is
needed locally; both are mandatory in production, because a retry engine that
silently does nothing looks exactly like a webhook that never arrives.

### Watch a delivery climb the curve

Point an endpoint at a receiver that always answers 500, then send it mail:

```bash
bun run post:inbound plain-text "support@$DOMAIN"
```

Expect: one immediate attempt, then a `webhook/delivery.failed` event in the
Inngest stream, a run that sleeps ~30s, then another attempt. The delivery row
stays `pending` with a rising `attempt` and the response code recorded:

```bash
curl -sS "$APP/api/v1/endpoints/$ENDPOINT_ID/deliveries" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

The curve is `0 / 30s / 2m / 10m / 1h / 6h / 24h` with ±15% jitter — seven
attempts over roughly 31 hours. After the seventh the row is `failed` and
nothing further is scheduled.

Flip the receiver to 200 mid-chain and the next attempt delivers; no further
event is emitted.

### Manual retry

```bash
curl -sS -X POST "$APP/api/v1/deliveries/$DELIVERY_ID/retry" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

Or the **Retry** button in the delivery log. Both requeue and then go through
the same atomic claim a scheduled retry uses — there is no path that skips it,
because an operator presses that button exactly when a scheduled retry is due.

A delivery that is already `delivered`, or in flight right now, comes back
`{"skipped":true,"reason":"not-retryable"}`. That is not an error; there was
nothing to do.

### Prove two executions cannot both deliver

Replay the same `webhook/delivery.failed` event twice from the Inngest
dashboard, or press Retry while a run is sleeping. Exactly one attempt should
reach the receiver: whoever wins the claim delivers, and the other returns
`{"skipped":true,"reason":"already-claimed-or-complete"}`.

A delivery that has finally `failed` refuses a scheduled attempt outright — only
`requeue`, and therefore only a deliberate manual retry, brings it back.

### If a delivery is stuck in `delivering`

It should not be, and it repairs itself. The claim will take a `delivering` row
whose lease has expired — the request timeout plus 30 seconds — so a function
that died mid-attempt is picked up by the next retry rather than stranded.

---

## 7. The event stream (Phase 9)

Everything, newest first:

```bash
curl -sS "$APP/api/v1/events?limit=20" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

Filters compose. `type` may repeat; an unknown one is a 400 rather than a
silently unfiltered stream, which would read as "no events of that kind":

```bash
curl -sS "$APP/api/v1/events?type=webhook.failed&type=webhook.delivered&endpointId=$ENDPOINT_ID" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"

curl -sS "$APP/api/v1/events?addressId=$ADDRESS_ID&since=2026-09-01T00:00:00Z" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

Filtering by address includes mail that never became a message. `email.rejected`
has no message and therefore no address — only a recipient in its metadata — and
it is exactly what someone asking "where did that mail go?" is looking for. Send
one and check it appears:

```bash
bun run post:inbound plain-text "nobody@$DOMAIN"
```

### Paging

Follow `nextCursor` back through the stream:

```bash
curl -sS "$APP/api/v1/events?limit=10&cursor=$NEXT_CURSOR" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

The cursor is `(occurred_at, id)`, not a timestamp alone. Events for one message
are written in a single transaction and routinely share a millisecond, so a
timestamp-only cursor drops whichever of them lands on a page boundary. A
malformed or stale cursor pages from the start rather than 400ing.

### In the dashboard

`/logs` carries the same filters in the URL, so a filtered view is a link worth
pasting into a conversation about what happened to somebody's mail. The message
viewer renders the same timeline component for one message, with a link through
to everything for that address.
