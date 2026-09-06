import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/icon';
import { PageHeader } from '@/components/layout/page-shell';
import { EmailBody } from '@/components/mail/email-body';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Message · MailPiston' };

export default async function EmailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const email = await repositories.emails.findById(id);
  if (!email) notFound();

  const [attachments, events] = await Promise.all([
    repositories.emails.listAttachments(email.id),
    repositories.events.list({ emailId: email.id, limit: 20 }),
  ]);

  return (
    <>
      <PageHeader
        title={email.subject || '(no subject)'}
        description={`From ${email.from}`}
        actions={
          <Link
            href="/inbox"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
          >
            <Icon name="arrowLeft" size={14} />
            Inbox
          </Link>
        }
      />

      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border bg-card p-4 text-sm">
        <Field label="To">{email.to.join(', ') || '—'}</Field>
        {email.cc.length > 0 ? <Field label="Cc">{email.cc.join(', ')}</Field> : null}
        <Field label="Received">
          {(email.receivedAt ?? email.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
        </Field>
        <Field label="Message-ID">{email.messageId ?? '—'}</Field>
        <Field label="Status">{email.status}</Field>
      </dl>

      <EmailBody html={email.html} text={email.text} />

      {attachments.length > 0 ? (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-medium">
            Attachments ({attachments.length})
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-3 px-4 py-2.5">
                <Icon name="attachment" size={14} className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {attachment.filename}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(attachment.sizeBytes)}
                </span>
                <a
                  href={`/api/v1/attachments/${attachment.id}/download`}
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <Icon name="download" size={13} />
                  Download
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {events.items.length > 0 ? (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-medium">History</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-sm">
            {events.items.map((event) => (
              <li key={event.id} className="flex items-baseline gap-3 px-4 py-2">
                <span className="font-mono text-xs">{event.type}</span>
                <span className="flex-1" />
                <time className="text-xs text-muted-foreground">
                  {event.occurredAt.toISOString().replace('T', ' ').slice(0, 19)} UTC
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-xs">{children}</dd>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
