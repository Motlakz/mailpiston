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
APP='https://mailpiston.vercel.app'          # or http://localhost:3000
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
curl -sS -X POST "https://api.forwardemail.net/v1/domains/$DOMAIN/verify-records" \
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
