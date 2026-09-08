import Link from 'next/link';

import { Icon } from '@/components/icon';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { ComposeForm } from '@/components/mail/compose';
import { formatWhen, previewOf } from '@/lib/format';
import type { EmailStatus } from '@/server/core/types';
import { getOutboundQuota } from '@/server/mail/emails/quota';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Sent · MailPiston' };

export default async function SentPage() {
  const [{ items }, addresses, quota] = await Promise.all([
    repositories.emails.list({ direction: 'outbound', limit: 100 }),
    repositories.addresses.list(),
    getOutboundQuota(),
  ]);

  const sendable = addresses
    .filter((address) => address.canSend && address.enabled && address.providerAliasId)
    .map((address) => ({ id: address.id, email: address.email }));

  return (
    <>
      <PageHeader
        title="Sent"
        description="Messages sent from a managed address, including relayed replies."
        actions={<ComposeForm addresses={sendable} />}
      />

      {quota ? <QuotaBar quota={quota} /> : null}

      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState
            icon="sent"
            title="Nothing sent yet"
            description="Compose a message from a send-capable address, or reply to something in the Inbox."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {items.map((email) => {
              const when = email.sentAt ?? email.createdAt;
              const preview = previewOf(email.text);

              return (
                <Link
                  key={email.id}
                  href={`/inbox/${email.id}`}
                  className="flex items-baseline gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-muted/40"
                >
                  <span className="w-52 shrink-0 truncate text-sm font-medium">
                    {email.to.join(', ') || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1 truncate text-sm">
                    {email.subject || (
                      <span className="text-muted-foreground">(no subject)</span>
                    )}
                    {preview ? (
                      <span className="ml-2 text-muted-foreground">
                        — {preview}
                      </span>
                    ) : null}
                  </span>

                  <StatusBadge status={email.status} />

                  <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">
                    {email.from}
                  </span>

                  <time
                    dateTime={when.toISOString()}
                    title={`${when.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
                    className="w-24 shrink-0 text-right text-xs text-muted-foreground"
                  >
                    {formatWhen(when)}
                  </time>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Today's send usage against the provider's own daily limit.
 *
 * The bar is drawn only when the provider reports a limit. A bar with no
 * denominator would have to invent one, and the monthly allowance is the plan's
 * advertised figure — carried separately, never derived by multiplying the
 * daily number by thirty.
 */
function QuotaBar({
  quota,
}: {
  quota: {
    daily: { used: number; limit: number | null };
    monthlyAllowance: number | null;
  };
}) {
  const { used, limit } = quota.daily;
  const ratio = limit ? Math.min(used / limit, 1) : null;

  const tone =
    ratio === null || ratio < 0.75
      ? 'bg-success'
      : ratio < 0.95
        ? 'bg-warning'
        : 'bg-destructive';

  return (
    <section className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name="sent" size={13} />
        Sent today
      </span>

      <span className="font-mono text-xs">
        {used.toLocaleString()}
        {limit === null ? '' : ` / ${limit.toLocaleString()}`}
      </span>

      {ratio === null ? (
        <span className="text-xs text-muted-foreground">
          The provider reports no daily limit.
        </span>
      ) : (
        <span
          className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${Math.round(ratio * 100)}% of today's send limit used`}
        >
          <span
            className={`block h-full rounded-full ${tone}`}
            style={{ width: `${Math.max(ratio * 100, 2)}%` }}
          />
        </span>
      )}

      {quota.monthlyAllowance ? (
        <span className="text-xs text-muted-foreground">
          {quota.monthlyAllowance.toLocaleString()} / month on this plan
        </span>
      ) : null}
    </section>
  );
}

const STATUS_TONE: Record<EmailStatus, string> = {
  received: 'border-border text-muted-foreground',
  queued: 'border-warning/40 text-warning',
  sent: 'border-success/40 text-success',
  delivered: 'border-success/40 text-success',
  soft_bounced: 'border-warning/40 text-warning',
  hard_bounced: 'border-destructive/40 text-destructive',
  failed: 'border-destructive/40 text-destructive',
};

/**
 * A bounce is not a failure and is worth telling apart at a glance: `failed`
 * means we never handed it to the provider, `hard_bounced` means the provider
 * did and the far end refused it.
 */
function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[status]}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}
