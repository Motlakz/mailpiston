'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ApiRequestError, apiRequest } from '@/lib/api-client';
import type { SpamVerdict } from '@/server/core/types';

/**
 * What an operator can do to a message from a list row or its own page
 * (roadmap Phase 12).
 *
 * The set of buttons is derived from where the message is, not passed in, so a
 * row cannot offer an action the server would refuse. A binned message offers
 * restore and permanent delete; a quarantined one offers "not spam"; everything
 * else offers "spam" and the bin.
 *
 * Only one action here is irreversible, and it is the only one that asks.
 */
export function MessageActions({
  emailId,
  verdict,
  binned,
  outbound = false,
  /** Rows are cramped; the message page has room for words. */
  compact = false,
}: {
  emailId: string;
  verdict: SpamVerdict;
  binned: boolean;
  outbound?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run(key: string, call: () => Promise<unknown>) {
    setError(null);
    setBusy(key);

    try {
      await call();
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'Something went wrong. Check the server logs.',
      );
    } finally {
      setBusy(null);
    }
  }

  const reclassify = (spamVerdict: 'clean' | 'spam') =>
    run(spamVerdict, () =>
      apiRequest(`/api/v1/emails/${emailId}/classification`, {
        method: 'PUT',
        body: JSON.stringify({ spamVerdict }),
      }),
    );

  const actions: Array<{
    key: string;
    label: string;
    icon: 'spam' | 'shield' | 'delete' | 'restore';
    danger?: boolean;
    onClick: () => void;
  }> = [];

  if (binned) {
    actions.push({
      key: 'restore',
      label: 'Restore',
      icon: 'restore',
      onClick: () =>
        run('restore', () =>
          apiRequest(`/api/v1/emails/${emailId}/restore`, { method: 'PUT' }),
        ),
    });

    actions.push({
      key: 'purge',
      label: 'Delete forever',
      icon: 'delete',
      danger: true,
      onClick: () => {
        // The one action in the product that cannot be undone, and the only
        // one that asks before doing it.
        if (
          !window.confirm(
            'Permanently delete this message and its attachments? This cannot be undone.',
          )
        ) {
          return;
        }

        run('purge', () =>
          apiRequest(`/api/v1/emails/${emailId}?purge=true`, {
            method: 'DELETE',
          }),
        );
      },
    });
  } else {
    // Outbound mail is sent by this deployment rather than received by it, so
    // there is nothing to classify — the server refuses it either way.
    if (!outbound) {
      actions.push(
        verdict === 'spam'
          ? {
              key: 'clean',
              label: 'Not spam',
              icon: 'shield',
              onClick: () => reclassify('clean'),
            }
          : {
              key: 'spam',
              label: 'Spam',
              icon: 'spam',
              onClick: () => reclassify('spam'),
            },
      );
    }

    actions.push({
      key: 'bin',
      label: 'Bin',
      icon: 'delete',
      onClick: () =>
        run('bin', () =>
          apiRequest(`/api/v1/emails/${emailId}`, { method: 'DELETE' }),
        ),
    });
  }

  return (
    <span className="flex items-center gap-1">
      {actions.map((action) => (
        <Button
          key={action.key}
          variant="ghost"
          size={compact ? 'icon-sm' : 'sm'}
          disabled={busy !== null}
          aria-label={action.label}
          title={action.label}
          className={action.danger ? 'text-destructive hover:text-destructive' : undefined}
          onClick={(event) => {
            // Rows are links. Without this, acting on a message navigates to it.
            event.preventDefault();
            event.stopPropagation();
            action.onClick();
          }}
        >
          <Icon name={action.icon} size={compact ? 12 : 13} />
          {compact ? null : action.label}
        </Button>
      ))}

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

/**
 * Emptying the bin.
 *
 * Says how many it will destroy, because "Empty bin" on a screen showing ten
 * rows and "Empty bin" on one showing four thousand are very different
 * decisions and should not read identically.
 */
export function EmptyBinButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (count === 0) return null;

  return (
    <span className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        className="text-destructive hover:text-destructive"
        onClick={async () => {
          if (
            !window.confirm(
              `Permanently delete ${count} ${count === 1 ? 'message' : 'messages'} and their attachments? This cannot be undone.`,
            )
          ) {
            return;
          }

          setBusy(true);
          setError(null);

          try {
            await apiRequest('/api/v1/mail-bin', { method: 'DELETE' });
            router.refresh();
          } catch (caught) {
            setError(
              caught instanceof ApiRequestError
                ? caught.message
                : 'Something went wrong. Check the server logs.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="delete" size={13} />
        {busy ? 'Deleting…' : `Empty bin (${count})`}
      </Button>

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
