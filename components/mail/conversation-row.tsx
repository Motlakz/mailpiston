'use client';

import Link from 'next/link';

import { Icon } from '@/components/icon';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDay, previewOf } from '@/lib/format';
import { useEmailOverlay, useIsSelected, useOptimisticStore } from '@/lib/optimistic-store';
import type { EmailListItem } from '@/server/core/types';

export function ConversationRow({
  email,
  href,
  selected,
}: {
  email: EmailListItem;
  href: string;
  selected: boolean;
}) {
  /**
   * The row's own in-flight state, layered over what the server rendered.
   *
   * A row that was just binned or reclassified is leaving this list, so it goes
   * immediately rather than sitting there looking untouched until the server
   * re-render lands. `gone` collapses it; `pending` dims what is still on its
   * way.
   */
  const overlay = useEmailOverlay(email.id);
  const checked = useIsSelected(email.id);
  const toggleSelected = useOptimisticStore((state) => state.toggleSelected);

  if (overlay?.gone) return null;

  const outbound = email.direction === 'outbound';
  const when = outbound
    ? (email.sentAt ?? email.createdAt)
    : (email.receivedAt ?? email.createdAt);

  const counterparty = (outbound ? email.to.join(', ') : email.from) || '—';
  const preview = previewOf(email.text);

  return (
    <Link
      href={href}
      // The list is pinned; jumping to the top on every selection undoes that.
      scroll={false}
      aria-current={selected ? 'true' : undefined}
      className="conversation-row"
      data-selected={selected ? '' : undefined}
      data-pending={overlay?.pending ? '' : undefined}
      data-checked={checked ? '' : undefined}
    >
      <span className="conversation-row__pick">
        {/* Label-free checkbox over the avatar: the row is a link, so this has
            to stop the click before navigation rather than after it. */}
        <input
          type="checkbox"
          checked={checked}
          aria-label={`Select ${email.subject || 'message'}`}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation();
            toggleSelected(email.id);
          }}
        />
        <span className="conversation-row__avatar" aria-hidden>
          {initialsOf(counterparty)}
        </span>
      </span>

      <span className="conversation-row__body">
        <span className="conversation-row__top">
          <strong>{displayNameOf(counterparty)}</strong>
          <time
            dateTime={when.toISOString()}
            title={`${when.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
          >
            {formatDay(when)}
          </time>
        </span>

        <span className="conversation-row__subject">
          {email.subject || <em>(no subject)</em>}
        </span>

        {preview ? (
          <span className="conversation-row__preview">{preview}</span>
        ) : null}

        <span className="conversation-row__meta">
          {outbound ? (
            <span className="conversation-row__tag">Sent</span>
          ) : (
            <span className="conversation-row__tag">
              {email.addressEmail ?? 'Received'}
            </span>
          )}

          {email.spamVerdict !== 'clean' ? (
            <StatusBadge
              status={email.spamVerdict}
              label={email.spamVerdict === 'spam' ? 'Quarantined' : 'Suspicious'}
            />
          ) : null}

          {outbound ? <StatusBadge status={email.status} /> : null}

          {email.attachmentCount > 0 ? (
            <span className="conversation-row__clip">
              <Icon name="attachment" size={11} />
              {email.attachmentCount}
            </span>
          ) : null}

        </span>
      </span>
    </Link>
  );
}

function initialsOf(value: string): string {
  const local = value.split('<').pop()?.split('@')[0] ?? value;
  const words = local.split(/[\s._-]+/).filter(Boolean);

  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  return local.slice(0, 2).toUpperCase() || '?';
}

/** The display name where the header carries one, the address where it does not. */
function displayNameOf(value: string): string {
  const match = value.match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() : value;
}
