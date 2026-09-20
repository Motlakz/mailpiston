import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/icon';
import { PageHeader } from '@/components/layout/page-shell';
import { EmailBody } from '@/components/mail/email-body';
import { EventTimeline } from '@/components/mail/event-timeline';
import { ReplyForm } from '@/components/mail/compose';
import { MessageActions } from '@/components/mail/message-actions';
import type { Email } from '@/server/core/types';
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
          <>
          <MessageActions
            emailId={email.id}
            verdict={email.spamVerdict}
            binned={Boolean(email.deletedAt)}
            outbound={email.direction === 'outbound'}
          />
          <Link
            href={email.direction === 'outbound' ? '/mail?show=sent' : '/mail'}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
          >
            <Icon name="arrowLeft" size={14} />
            Mail
          </Link>
          </>
        }
      />

      <ClassificationPanel email={email} />

      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 rounded-lg bg-card p-5 text-sm ring-1 ring-foreground/10">
        <Field label="To">{email.to.join(', ') || '—'}</Field>
        {email.cc.length > 0 ? <Field label="Cc">{email.cc.join(', ')}</Field> : null}
        <Field label="Received">
          {(email.receivedAt ?? email.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
        </Field>
        <Field label="Message-ID">{email.messageId ?? '—'}</Field>
        <Field label="Thread">
          {email.threadId ? (
            <Link href={`/threads/${email.threadId}`} className="text-primary hover:underline">
              View conversation
            </Link>
          ) : (
            '—'
          )}
        </Field>
        <Field label="Status">{email.status}</Field>
      </dl>

      <EmailBody html={email.html} text={email.text} />

      {email.direction === 'inbound' && !email.deletedAt && email.spamVerdict !== 'spam' ? (
        <ReplyForm emailId={email.id} />
      ) : null}

      {attachments.length > 0 ? (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-medium">
            Attachments ({attachments.length})
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
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
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium">History</h2>
            <Link
              href={`/logs?addressId=${email.addressId ?? ''}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              All events for this address
            </Link>
          </div>
          {/* The same component the Logs page renders. Two timelines that could
              disagree would mean one of them is lying about what happened. */}
          <EventTimeline events={events.items} />
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

/**
 * Why this message is where it is (roadmap Phase 12).
 *
 * Shown for anything not `clean`, and it lists the rules by name with their
 * scores. That is deliberate and slightly unusual for a spam UI: the operator
 * is a developer, this filter runs on their own mail, and the only way they can
 * decide whether to trust it — or write an allow rule against it — is to see
 * what it actually keyed on.
 */
function ClassificationPanel({ email }: { email: Email }) {
  if (email.spamVerdict === 'clean') return null;

  const quarantined = email.spamVerdict === 'spam';

  return (
    <section
      className={`mb-5 rounded-lg border px-4 py-3 ${
        quarantined ? 'border-destructive/40' : 'border-warning/40'
      } bg-card`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          className={`text-sm font-medium ${quarantined ? 'text-destructive' : 'text-warning'}`}
        >
          {quarantined
            ? 'Quarantined as ' + (email.spamCategory ?? 'spam')
            : 'Flagged as ' + (email.spamCategory ?? 'suspicious')}
        </h2>
        <span className="text-xs text-muted-foreground">score {email.spamScore}</span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {quarantined
          ? 'This message was stored but not delivered onward: no webhook fired and no personal inbox received it.'
          : 'This message was delivered normally. It is marked only so you can see what the filter noticed.'}
      </p>

      {email.spamSignals.length > 0 ? (
        <ul className="mt-2.5 flex flex-col gap-1">
          {email.spamSignals.map((signal, index) => (
            <li
              key={`${signal.rule}-${index}`}
              className="flex flex-wrap items-baseline gap-2 text-xs"
            >
              <code className="font-mono text-[11px]">{signal.rule}</code>
              <span
                className={
                  signal.score < 0 ? 'text-success' : 'text-muted-foreground'
                }
              >
                {signal.score > 0 ? `+${signal.score}` : signal.score}
              </span>
              {signal.detail ? (
                <span className="text-muted-foreground">{signal.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
