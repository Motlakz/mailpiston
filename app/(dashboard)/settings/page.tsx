import { PageHeader } from '@/components/layout/page-shell';
import { FilterLists } from '@/components/mail/filter-lists';
import { ProviderConnection } from '@/components/mail/provider-connection';
import { env } from '@/server/core/config';
import { hasTenantApiToken } from '@/server/core/tenancy/credentials';
import { sendUsageFor } from '@/server/core/tenancy/limits';
import { repositoriesFor } from '@/server/repositories';
import { requireOperatorPage } from '@/server/core/auth';

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
  const { tenantId } = await requireOperatorPage();
  const repositories = repositoriesFor(tenantId);
  const [audit, filters, providerConnected, sendUsage] = await Promise.all([
    repositories.audit.list({ limit: 50 }),
    repositories.mailFilters.list(),
    hasTenantApiToken(tenantId),
    sendUsageFor(tenantId, repositories.emails),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configuration is read-only here — it is parsed from the environment at boot. This page shows what is in force, and who changed what."
      />

      <section className="rounded-lg bg-card ring-1 ring-foreground/10">
        <header className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium">Mail provider</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            MailPiston is the control plane. Transport is bought from a
            specialist on your own account, so the bill and the reputation
            stay yours.
          </p>
        </header>

        <div className="px-5 py-4">
          <ProviderConnection connected={providerConnected} />
        </div>
      </section>

      <section className="rounded-lg bg-card ring-1 ring-foreground/10">
        <header className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium">Monthly sending</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Domains are never metered. Messages are — they are the part that
            costs something.
          </p>
        </header>

        <div className="send-usage">
          <p className="send-usage__figure">
            <strong>{sendUsage.used.toLocaleString()}</strong>
            <span>of {sendUsage.limit.toLocaleString()} sent this month</span>
          </p>

          <div
            className="send-usage__bar"
            role="progressbar"
            aria-valuenow={sendUsage.used}
            aria-valuemin={0}
            aria-valuemax={sendUsage.limit}
          >
            <span
              style={{
                width: `${Math.min(100, (sendUsage.used / Math.max(1, sendUsage.limit)) * 100)}%`,
              }}
              data-full={sendUsage.remaining === 0 ? '' : undefined}
            />
          </div>

          <p className="send-usage__note">
            {sendUsage.remaining === 0
              ? 'The allowance is spent. Sending resumes when the window rolls over.'
              : `${sendUsage.remaining.toLocaleString()} remaining.`}{' '}
            Resets {sendUsage.resetsAt.toISOString().slice(0, 10)}. Receiving is
            never blocked by this — losing a message somebody sent you is not a
            failure worth trading for a limit.
          </p>
        </div>
      </section>

      <section className="rounded-lg bg-card ring-1 ring-foreground/10">
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

      {/* Unlike everything above, these ARE editable here — they are the
          operator's own judgement about senders rather than deployment
          configuration, and they have to be changeable the moment the filter
          gets somebody wrong. */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium">Mail filtering</h2>
        <FilterLists entries={filters} />
      </section>

      <section className="rounded-lg bg-card ring-1 ring-foreground/10">
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
