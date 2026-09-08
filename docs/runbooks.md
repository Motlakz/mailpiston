# Runbooks

Operational procedures for MailPiston. Companion to
[`security-review.md`](./security-review.md) and
[`manual-testing.md`](./manual-testing.md).

Every rotation here follows the same shape: **make the new credential work
before the old one stops.** The exception is a credential being rotated because
it leaked, where the old one has to stop immediately and the disruption is the
point.

---

## 1. Rotating the encryption key

`SECRET_ENCRYPTION_KEY` encrypts every stored webhook key and endpoint signing
secret. Changing it naively makes all of them undecryptable at once — inbound
signature verification and outbound webhook signing both stop, and neither
failure is obviously about a key.

`decryptSecret` therefore tries the current key, then
`SECRET_ENCRYPTION_KEY_PREVIOUS`. That makes rotation a migration:

1. **Generate a new key.**

   ```bash
   openssl rand -hex 32
   ```

2. **Set both variables**, old as previous, new as current, and deploy. Nothing
   has been re-encrypted yet; every existing ciphertext decrypts under
   `_PREVIOUS`.

   ```text
   SECRET_ENCRYPTION_KEY=<new>
   SECRET_ENCRYPTION_KEY_PREVIOUS=<old>
   ```

3. **Re-encrypt the stored rows.** Each is rewritten by setting it again, which
   encrypts under whatever key is current:

   - endpoint signing secrets — there is no re-encrypt-in-place action, so
     rotate each one (`POST /v1/endpoints/:id/rotate-secret`) and redeploy the
     receiving applications with the new secret. Rotation has no grace period,
     so do one endpoint at a time.
   - domain webhook keys — re-save each from the Domains page, or
     `PUT /v1/domains/:id/webhook-key` with the same key from the Forward Email
     dashboard.

4. **Remove `SECRET_ENCRYPTION_KEY_PREVIOUS`** and deploy. A retired key that
   stays configured is a second live key.

5. **Verify** by sending a signed inbound delivery
   (`bun run post:inbound plain-text …`) and a webhook test delivery. Both
   exercise a decrypt.

If the key was rotated because it **leaked**, do not run this gradually. Rotate
every endpoint secret and every domain webhook key first, then drop `_PREVIOUS`
in the same deploy — a leaked key that still decrypts is still a leaked key.

---

## 2. Rotating an endpoint signing secret

```bash
curl -sS -X POST "$APP/api/v1/endpoints/$ENDPOINT_ID/rotate-secret" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

The new secret is in the response and nowhere else. There is **no grace
period**: deliveries between this call and the receiver being redeployed fail
verification, land as `pending`, and are retried on the normal schedule — seven
attempts over roughly 31 hours, which is the real window you have to redeploy in.

Honouring two secrets at once was considered and rejected: a secret rotated
because it leaked would keep working until somebody remembered to remove it.

Recovery if the redeploy overruns the retry window: the failed deliveries sit
`failed` in the delivery log and can be retried by hand from the Endpoints page.

---

## 3. Rotating an API key

```bash
curl -sS -X POST "$APP/api/v1/api-keys" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MAILPISTON_API_KEY" \
  -d '{"name":"deploy script (rotated 2026-09-08)"}'
```

Deploy the new key everywhere it is used, confirm `lastUsedAt` on the new key
has moved, then revoke the old one:

```bash
curl -sS -X DELETE "$APP/api/v1/api-keys/$OLD_KEY_ID" \
  -H "Authorization: Bearer $MAILPISTON_API_KEY"
```

Revocation is a timestamp checked on every request — immediate, and nothing
about a key is cached. The row survives, because an audit trail that loses the
key a request was made with is not an audit trail.

If every key is lost, mint a new one from the dashboard. Operator sign-in is
GitHub OAuth behind an allow-list and does not depend on any API key.

---

## 4. Rotating the Forward Email webhook key

The provider issues one key per domain. Rotate it in the Forward Email
dashboard, then store the new one:

```bash
curl -sS -X PUT "$APP/api/v1/domains/$DOMAIN_ID/webhook-key" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MAILPISTON_API_KEY" \
  -d "{\"webhookKey\":\"$NEW_KEY\"}"
```

Inbound verification tries **every** stored key, so during the change both the
old and new keys verify and no delivery is rejected. The resolver caches for 60
seconds; whoever saved the key sees the change immediately.

Verify with a real delivery before considering it done — a wrong key here means
every inbound message returns 401 and the provider retries into a wall.

---

## 5. Rotating `BETTER_AUTH_SECRET`

Changing it invalidates every operator session. That is the entire effect: sign
in again. Do it if a session token may have leaked, and expect to re-authenticate
on every device.

---

## 6. Retention

Two variables, both unset by default, both in days:

```text
RETENTION_RAW_MIME_DAYS=30
RETENTION_ATTACHMENT_DAYS=365
```

Unset means keep forever, deliberately: the safe failure for a mail archive is
keeping too much, and an operator who has not chosen a policy has not consented
to one.

The nightly sweep (`prune-retained-objects`, 03:00 UTC) deletes bytes and marks
the row. **Metadata is never pruned** — a pruned attachment keeps its filename,
size, and the date its bytes went, and the download route answers `410 Gone`
with that date rather than a `404` that would read as "there was never an
attachment".

Raw MIME is the one to prune first: it is the bulk of the storage bill and the
least valuable, since the parsed message stays in Postgres regardless.

Setting a policy prunes retroactively — everything already older than the window
is swept over the following nights, in batches of 500 per kind. **Check what
that will remove before setting it**:

```sql
SELECT count(*), pg_size_pretty(sum(size_bytes))
FROM email_attachments
WHERE pruned_at IS NULL AND created_at < now() - interval '365 days';
```

There is no undo.

---

## 7. Backup and restore

> ⚠️ **This drill has not been performed.** Phase 11's acceptance criterion is
> that a restore has actually happened, not that it is written down. Until it
> has, treat everything below as untested.

### What has to survive

| Store | Holds | Recoverable without a backup? |
| --- | --- | --- |
| Neon | every message body, event, delivery, and configuration row | no |
| R2 | attachment bytes and raw MIME | no |
| Forward Email | domains and aliases | yes — reconciliation detects drift, and the catch-all can be repaired |

Neon is the one that matters. R2 holds bytes that Postgres references but
cannot reconstruct; Forward Email configuration is rebuildable from our own
rows.

### Backups

Neon takes continuous backups with point-in-time restore on paid plans; on the
free plan check the retention window and do not assume it is long. R2 needs
versioning or a lifecycle rule enabled explicitly — it is not on by default.

### The drill

1. Restore the Neon branch to a timestamp ~1 hour old, as a **new branch**, not
   over the top of production.
2. Point a local checkout at the restored branch's connection string and run
   `bun run db:migrate` — it should report nothing to apply.
3. Check the message count and the newest `mail_events` row against what the
   timestamp implies.
4. Open a message with an attachment and download it. This is the step that
   matters: it is the only one that proves Postgres and R2 still agree after a
   point-in-time restore, and they can disagree, because R2 was never rolled
   back. Expect attachments written *after* the restore point to exist in R2
   with no row referencing them — orphans, harmless — and no row to reference a
   key that is missing.
5. Run a reconciliation sweep against the restored branch and confirm it reports
   the provider state accurately.
6. Delete the branch.

Record the date it was last performed here:

```text
Last restore drill: never
```

---

## 8. Domain migration batches

Per plan §23. Move domains gradually; the point of the batches is that a
mistake costs two domains, not fifty.

```text
Batch 1: 2 test domains
Batch 2: 3 low-risk apps
Batch 3: 10 domains
Batch 4: 15 domains
Batch 5: remainder
```

Batch 1 runs a full week with zero lost messages before Batch 2 starts.

Per batch, verify every row — a batch is not done until all twelve pass:

| Check | How |
| --- | --- |
| MX | Domains page shows every inbound record `present` |
| SPF | same |
| DKIM | same |
| DMARC | same |
| inbound | send from an external mailbox; it appears in the Inbox |
| outbound | send from the dashboard; it arrives |
| reply | reply to an inbound message; **Gmail threads it with the original** |
| threading | the customer's reply rejoins the same thread |
| personal forwarding | bound inbox receives it, with a working reply relay |
| endpoint delivery | webhook endpoint receives a signed POST |
| bounce event | send to a known-dead address; status flips to `hard_bounced` |
| logs | the whole trail is on `/logs`, filtered by that address |

Cutting the app origin over to a new domain is a separate migration and must
happen **before** the large batches, while the alias count is small. Every
provider alias carries the absolute ingress URL as its recipient, so moving the
origin means repointing every alias: serve both origins, repoint through the
provider interface, and let a reconciliation sweep confirm zero drift before
retiring the old URL.
