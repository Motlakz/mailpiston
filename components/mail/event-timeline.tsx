import Link from 'next/link';

import { Icon, type IconName } from '@/components/icon';
import type { MailEvent } from '@/server/core/types';

/**
 * One event stream, rendered the same way everywhere it appears.
 *
 * The Logs page and the message viewer show the same rows, so they share a
 * component rather than two that drift — the moment they differ, one of them is
 * lying about what happened.
 */
export interface TimelineEvent extends Omit<MailEvent, 'occurredAt'> {
  occurredAt: string | Date;
}

/** Colour carries the outcome; the label carries the detail. */
const TONE: Record<string, string> = {
  delivered: 'text-success',
  sent: 'text-success',
  received: 'text-success',
  failed: 'text-destructive',
  rejected: 'text-destructive',
  hard_bounced: 'text-destructive',
  soft_bounced: 'text-warning',
  queued: 'text-muted-foreground',
};

const ICON: Record<string, IconName> = {
  email: 'inbox',
  personal_forward: 'sent',
  relay: 'sent',
  webhook: 'endpoints',
};

function outcomeOf(type: string): string {
  return type.split('.')[1] ?? '';
}

function subjectOf(type: string): string {
  return type.split('.')[0] ?? '';
}

/**
 * What actually happened, in words, from the event's own metadata.
 *
 * Metadata shapes differ per event type, so this reads defensively rather than
 * narrowing: an event whose detail cannot be summarised still has to render its
 * row, because the row is the audit trail.
 */
function detailOf(event: TimelineEvent): string | null {
  const meta = event.metadata as {
    reason?: unknown;
    error?: unknown;
    responseCode?: unknown;
    recipient?: unknown;
    attempt?: unknown;
    final?: unknown;
  };

  const parts: string[] = [];

  if (typeof meta.recipient === 'string') parts.push(meta.recipient);
  if (typeof meta.reason === 'string') parts.push(meta.reason);
  if (typeof meta.responseCode === 'number') parts.push(`HTTP ${meta.responseCode}`);
  if (typeof meta.attempt === 'number') parts.push(`attempt ${meta.attempt}`);
  if (meta.final === true) parts.push('final');
  if (typeof meta.error === 'string') parts.push(meta.error);

  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatTime(value: string | Date): string {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 19);
}

export function EventTimeline({
  events,
  showMessageLink = false,
}: {
  events: TimelineEvent[];
  /** On the Logs page a row needs to say which message it belongs to. */
  showMessageLink?: boolean;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {events.map((event) => {
        const detail = detailOf(event);

        return (
          <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
            <Icon
              name={ICON[subjectOf(event.type)] ?? 'logs'}
              size={13}
              className="shrink-0 self-center text-muted-foreground"
            />

            <span
              className={`font-mono text-xs ${TONE[outcomeOf(event.type)] ?? ''}`}
            >
              {event.type}
            </span>

            {detail ? (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {detail}
              </span>
            ) : (
              <span className="flex-1" />
            )}

            {showMessageLink && event.emailId ? (
              <Link
                href={`/inbox/${event.emailId}`}
                className="shrink-0 font-mono text-[11px] text-primary hover:underline"
              >
                {event.emailId}
              </Link>
            ) : null}

            <time className="shrink-0 text-xs text-muted-foreground">
              {formatTime(event.occurredAt)} UTC
            </time>
          </li>
        );
      })}
    </ul>
  );
}
