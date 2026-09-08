import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/icon';
import { PageHeader } from '@/components/layout/page-shell';
import { EmailBody } from '@/components/mail/email-body';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Thread · MailPiston' };

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const thread = await repositories.threads.findById(id);
  if (!thread) notFound();

  const { items } = await repositories.emails.list({
    threadId: thread.id,
    limit: 200,
  });

  // The list pages newest-first everywhere else; a conversation reads the
  // other way round.
  const messages = [...items].reverse();

  return (
    <>
      <PageHeader
        title={thread.subject || '(no subject)'}
        description={`${messages.length} message${messages.length === 1 ? '' : 's'}`}
        actions={
          <Link
            href="/threads"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
          >
            <Icon name="arrowLeft" size={14} />
            Threads
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        {messages.map((message) => (
          <article
            key={message.id}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  message.direction === 'inbound'
                    ? 'border-border text-muted-foreground'
                    : 'border-success/40 text-success'
                }`}
              >
                {message.direction}
              </span>
              <span className="text-sm font-medium">{message.from}</span>
              <span className="text-xs text-muted-foreground">
                → {message.to.join(', ') || '—'}
              </span>
              <time
                dateTime={(message.receivedAt ?? message.createdAt).toISOString()}
                className="ml-auto text-xs text-muted-foreground"
              >
                {(message.receivedAt ?? message.sentAt ?? message.createdAt)
                  .toISOString()
                  .replace('T', ' ')
                  .slice(0, 19)}{' '}
                UTC
              </time>
              <Link
                href={`/mail/${message.id}`}
                className="text-xs text-primary hover:underline"
              >
                Open
              </Link>
            </header>

            <div className="px-4 py-3">
              <EmailBody html={message.html} text={message.text} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
