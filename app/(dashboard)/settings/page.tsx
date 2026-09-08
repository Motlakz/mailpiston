import { PageHeader } from '@/components/layout/page-shell';
import { env } from '@/server/core/config';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Settings · MailPiston' };

/**
 * Read-only, and staying that way.
 *
 * Configuration lives in environment variables parsed once at boot, so a
 * misconfigured deployment fails immediately rather than on the first inbound
 * email. Making any of it editable here would move that failure to runtime and
 * split the source of truth in two.
 *
 * What this page is actually for is the second half of §24: the audit trail of
 * privileged mutations, which is worth nothing if nobody can read it.
 */
export default async function SettingsPage() {
  const audit = await repositories.audit.list({ limit: 50 });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configuration is read-only here — it is parsed from the environment at boot. This page shows what is in force, and who changed what."
      />

      <section className="mt-4 rounded-lg border border-border bg-card">
        <header className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium">In force</h2>
        </header>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 px-5 py-4 text-sm">
          <Setting label="App origin" value={env.APP_URL}>
            Every provider alias carries this as its recipient, so changing it
            is a migration, not a redeploy.
          </Setting>

          <Setting
            label="Relay domain"
            value={env.RELAY_DOMAIN ?? 'not configured'}
          >
            {env.RELAY_DOMAIN
              ? `Reply tokens expire after ${env.RELAY_TOKEN_TTL_DAYS} days.`
              : 'Forwarded mail carries no reply relay, so replying to it lands back on the managed address instead of reaching the customer.'}
          </Setting>

          <Setting
            label="Raw MIME"
            value={env.STORE_RAW_MIME ? 'stored' : 'not stored'}
          >
            {env.STORE_RAW_MIME
              ? retentionLabel(env.RETENTION_RAW_MIME_DAYS)
              : 'The best debugging artifact and the largest thing we would store.'}
          </Setting>

          <Setting
            label="Attachments"
            value={retentionLabel(env.RETENTION_ATTACHMENT_DAYS)}
          >
            Metadata is never pruned — a pruned attachment keeps its filename,
            size, and the date its bytes were removed.
          </Setting>

          <Setting
            label="Webhook timeout"
            value={`${env.WEBHOOK_TIMEOUT_MS} ms`}
          >
            The first delivery attempt runs inside the provider&apos;s inbound
            request; anything slower becomes a retry.
          </Setting>

          <Setting
            label="Retry engine"
            value={env.INNGEST_SIGNING_KEY ? 'configured' : 'not configured'}
          >
            {env.INNGEST_SIGNING_KEY
              ? 'Failed webhook deliveries retry seven times over roughly 31 hours.'
              : 'Failed deliveries will stay pending and never be retried.'}
          </Setting>
        </dl>
      </section>

      <section className="mt-4 rounded-lg border border-border bg-card">
        <header className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium">Audit trail</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Privileged mutations only, append-only, with secrets redacted before
            anything is written down.
          </p>
        </header>

        {audit.items.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {audit.items.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5"
              >
                <span className="font-mono">{entry.action}</span>
                <span className="font-mono text-muted-foreground">
                  {entry.resourceId ?? '—'}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {entry.actor}
                </span>
                <time className="shrink-0 text-muted-foreground">
                  {entry.occurredAt.toISOString().replace('T', ' ').slice(0, 19)}{' '}
                  UTC
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function retentionLabel(days: number | undefined): string {
  return days ? `kept ${days} days` : 'kept indefinitely';
}

function Setting({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        <span className="font-mono text-xs break-all">{value}</span>
        <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>
      </dd>
    </>
  );
}
