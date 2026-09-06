import Link from 'next/link';

import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { ComposeForm } from '@/components/mail/compose';
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

      {quota ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Provider quota — today: {quota.daily.used}
          {quota.daily.limit === null ? '' : ` / ${quota.daily.limit}`}
          {/* The monthly allowance is the plan's advertised figure, shown
              separately; nothing here multiplies the daily limit to invent it. */}
          {quota.monthlyAllowance
            ? ` · monthly allowance ${quota.monthlyAllowance.toLocaleString()}`
            : ''}
        </p>
      ) : null}

      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyState
            icon="sent"
            title="Nothing sent yet"
            description="Compose a message from a send-capable address, or reply to something in the Inbox."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {items.map((email) => (
              <Link
                key={email.id}
                href={`/inbox/${email.id}`}
                className="flex items-baseline gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-muted/40"
              >
                <span className="w-52 shrink-0 truncate text-sm font-medium">
                  {email.to.join(', ') || '—'}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {email.subject || (
                    <span className="text-muted-foreground">(no subject)</span>
                  )}
                </span>
                <StatusBadge status={email.status} />
                <time
                  dateTime={(email.sentAt ?? email.createdAt).toISOString()}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {(email.sentAt ?? email.createdAt)
                    .toISOString()
                    .replace('T', ' ')
                    .slice(0, 16)}
                </time>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'sent' || status === 'delivered'
      ? 'border-success/40 text-success'
      : status === 'queued'
        ? 'border-warning/40 text-warning'
        : 'border-destructive/40 text-destructive';

  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
      {status}
    </span>
  );
}
