import Link from 'next/link';

import { Icon } from '@/components/icon';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Inbox · MailPiston' };

export default async function InboxPage() {
  const { items } = await repositories.emails.list({
    direction: 'inbound',
    limit: 100,
  });

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Every message received by a managed address."
      />

      {items.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No messages yet"
          description="Send mail to one of your managed addresses. A verified provider POST becomes exactly one durable record here."
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
                {email.from}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {email.subject || (
                  <span className="text-muted-foreground">(no subject)</span>
                )}
                {email.text ? (
                  <span className="ml-2 text-muted-foreground">
                    — {email.text.replace(/\s+/g, ' ').slice(0, 120)}
                  </span>
                ) : null}
              </span>
              {email.attachmentCount > 0 ? (
                <Icon
                  name="attachment"
                  size={13}
                  className="shrink-0 text-muted-foreground"
                  aria-label={`${email.attachmentCount} attachments`}
                />
              ) : null}
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {email.addressEmail ?? '—'}
              </span>
              <time
                className="w-24 shrink-0 text-right text-xs text-muted-foreground"
                dateTime={(email.receivedAt ?? email.createdAt).toISOString()}
              >
                {formatWhen(email.receivedAt ?? email.createdAt)}
              </time>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Time for today, date for anything older — the usual mail-client shorthand. */
function formatWhen(date: Date): string {
  const isToday = new Date().toDateString() === date.toDateString();

  return isToday
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toISOString().slice(0, 10);
}
