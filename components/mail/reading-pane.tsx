import Link from 'next/link';

import { Icon } from '@/components/icon';
import { EmailBody } from '@/components/mail/email-body';
import { ReplyForm } from '@/components/mail/compose';
import { MessageActions } from '@/components/mail/message-actions';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatBytes } from '@/lib/format';
import { repositories } from '@/server/repositories';

export async function ReadingPane({ emailId }: { emailId: string }) {
  const email = await repositories.emails.findById(emailId);

  if (!email) {
    return (
      <div className="reading-pane reading-pane--empty">
        <p>That message is no longer here.</p>
        <Link href="/mail" className="text-primary hover:underline">
          Back to the list
        </Link>
      </div>
    );
  }

  const attachments = await repositories.emails.listAttachments(email.id);
  const outbound = email.direction === 'outbound';
  const when = outbound
    ? (email.sentAt ?? email.createdAt)
    : (email.receivedAt ?? email.createdAt);

  return (
    <div className="reading-pane">
      <header className="reading-pane__head">
        <div className="reading-pane__toolbar">
          <span className="reading-pane__crumbs">
            {outbound ? 'Sent' : 'Received'}
          </span>

          <div className="reading-pane__tools">
            <MessageActions
              emailId={email.id}
              verdict={email.spamVerdict}
              binned={Boolean(email.deletedAt)}
              outbound={outbound}
              compact
            />
            <Link
              href={`/mail/${email.id}`}
              className="reading-pane__expand"
              aria-label="Open as a full page"
              title="Open as a full page"
            >
              <Icon name="arrowRight" size={13} />
            </Link>
          </div>
        </div>

        <h2>{email.subject || '(no subject)'}</h2>
      </header>

      <div className="reading-pane__body">
        <div className="reading-pane__from">
          <span className="reading-pane__avatar" aria-hidden>
            {(email.from.split('@')[0] || '?').slice(0, 2).toUpperCase()}
          </span>
          <span>
            <strong>{email.from}</strong>
            <small>
              to {email.to.join(', ') || '—'}
              {email.cc.length > 0 ? ` · cc ${email.cc.join(', ')}` : null}
            </small>
          </span>
          <time
            dateTime={when.toISOString()}
            title={`${when.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
          >
            {when.toISOString().replace('T', ' ').slice(0, 16)} UTC
          </time>
        </div>

        {email.spamVerdict !== 'clean' ? (
          <p className="reading-pane__flag">
            <StatusBadge
              status={email.spamVerdict}
              label={email.spamVerdict === 'spam' ? 'Quarantined' : 'Suspicious'}
            />
            {email.spamVerdict === 'spam'
              ? 'Held here. It reached no webhook and no personal inbox.'
              : 'Delivered, but it matched enough signals to be worth a look.'}
          </p>
        ) : null}

        <EmailBody html={email.html} text={email.text} />

        {attachments.length > 0 ? (
          <section className="reading-pane__attachments">
            <h3>Attachments ({attachments.length})</h3>
            <ul>
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <Icon name="attachment" size={13} />
                  <span>{attachment.filename}</span>
                  <small>{formatBytes(attachment.sizeBytes)}</small>
                  <a href={`/api/v1/attachments/${attachment.id}/download`}>
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!outbound && !email.deletedAt && email.spamVerdict !== 'spam' ? (
          <ReplyForm emailId={email.id} />
        ) : null}
      </div>
    </div>
  );
}

export function ReadingPaneSkeleton() {
  return (
    <div className="reading-pane reading-pane--loading" aria-busy="true">
      <header className="reading-pane__head">
        <div className="reading-pane__toolbar">
          <span className="skeleton-bar" style={{ width: '4.5rem' }} />
        </div>
        <span className="skeleton-bar" style={{ width: '60%', height: '1.05rem' }} />
      </header>

      <div className="reading-pane__body">
        <div className="reading-pane__from">
          <span className="skeleton-avatar" />
          <span style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
            <span className="skeleton-bar" style={{ width: '11rem' }} />
            <span className="skeleton-bar" style={{ width: '7rem' }} />
          </span>
        </div>
        <span className="skeleton-bar" style={{ height: '9rem' }} />
      </div>
    </div>
  );
}

/** Shown when nothing is selected — the pane is never an empty rectangle. */
export function ReadingPanePlaceholder() {
  return (
    <div className="reading-pane reading-pane--empty">
      <span className="reading-pane__placeholder-mark" aria-hidden>
        <Icon name="inbox" size={20} />
      </span>
      <p>Pick a conversation to read it here.</p>
      <small>Replies keep the thread and send from the managed address.</small>
    </div>
  );
}
