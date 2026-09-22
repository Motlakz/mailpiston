'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Icon, type IconName } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ApiRequestError, apiRequest } from '@/lib/api-client';
import { useOptimisticStore } from '@/lib/optimistic-store';
import type { SpamVerdict } from '@/server/core/types';

/**
 * What an operator can do to a message from a list row or its own page.
 *
 * The set of buttons is derived from where the message is, not passed in, so a
 * row cannot offer an action the server would refuse. A binned message offers
 * restore and permanent delete; a quarantined one offers "not spam"; everything
 * else offers "spam" and the bin.
 *
 * Only one action here is irreversible, and it is the only one that asks —
 * through `ConfirmDialog`, which also owns showing progress and keeping itself
 * open if the request fails. A destructive action that failed silently and
 * closed would leave the operator believing it worked.
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
  // `isPending` stays true for the server re-render, not just the request. It
  // used to be discarded, so the spinner switched off the instant the refresh
  // was *scheduled* — and the operator watched a settled-looking screen for the
  // whole round trip with nothing but the console to say it was working.
  const [refreshing, startTransition] = useTransition();
  const { confirmProps, ask } = useConfirm();
  const applyEmail = useOptimisticStore((state) => state.applyEmail);
  const clearEmail = useOptimisticStore((state) => state.clearEmail);

  const pending = busy !== null || refreshing;

  async function run(
    key: string,
    call: () => Promise<unknown>,
    options?: {
      /** Applied the moment the button is pressed, rolled back on failure. */
      optimistic?: Parameters<typeof applyEmail>[1];
      onDone?: () => void;
    },
  ) {
    setError(null);
    setBusy(key);
    if (options?.optimistic) applyEmail(emailId, options.optimistic);

    try {
      await call();
      startTransition(() => router.refresh());
      options?.onDone?.();
    } catch (caught) {
      // The guess was wrong; the server's version is what stays on screen.
      clearEmail(emailId);
      const message =
        caught instanceof ApiRequestError
          ? caught.message
          : 'Something went wrong. Check the server logs.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  const reclassify = (spamVerdict: 'clean' | 'spam') =>
    run(
      spamVerdict,
      () =>
        apiRequest(`/api/v1/emails/${emailId}/classification`, {
          method: 'PUT',
          body: JSON.stringify({ spamVerdict }),
        }),
      {
        // Moving a message to or from quarantine takes it out of the list you
        // are looking at, so the row goes at once rather than lingering.
        optimistic: { spamVerdict, gone: true },
        onDone: () =>
          toast(
            spamVerdict === 'spam'
              ? 'Quarantined. It will not be fanned out.'
              : 'Released from quarantine.',
          ),
      },
    );

  const actions: Array<{
    key: string;
    label: string;
    icon: IconName;
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
      onClick: () =>
        ask({
          title: 'Delete this message permanently?',
          description:
            'The message and its attachments are removed for good. This is the one action in MailPiston that cannot be undone.',
          confirmLabel: 'Delete forever',
          destructive: true,
          onConfirm: async () => {
            await apiRequest(`/api/v1/emails/${emailId}?purge=true`, {
              method: 'DELETE',
            });
            startTransition(() => router.refresh());
          },
        }),
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
      // Undo, not a confirm. Confirming a reversible action trains people to
      // dismiss dialogs, which is exactly what you do not want by the time one
      // matters — and it puts the cost on every bin rather than on the rare
      // mistake. The row leaves immediately and the toast carries the way back.
      onClick: () =>
        run(
          'bin',
          () => apiRequest(`/api/v1/emails/${emailId}`, { method: 'DELETE' }),
          {
            optimistic: { binned: true, gone: true },
            onDone: () =>
              toast('Moved to the bin.', {
                action: {
                  label: 'Undo',
                  onClick: () =>
                    run(
                      'restore',
                      () =>
                        apiRequest(`/api/v1/emails/${emailId}/restore`, {
                          method: 'PUT',
                        }),
                      { optimistic: { binned: false, gone: false } },
                    ),
                },
              }),
          },
        ),
    });
  }

  return (
    <span className="flex items-center gap-1">
      {actions.map((action) =>
        compact ? (
          <Tooltip key={action.key}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label={action.label}
                  className={
                    action.danger
                      ? 'text-muted-foreground hover:text-destructive'
                      : 'text-muted-foreground hover:text-foreground'
                  }
                  onClick={(event) => {
                    // Rows are links. Without this, acting on a message opens it.
                    event.preventDefault();
                    event.stopPropagation();
                    action.onClick();
                  }}
                />
              }
            >
              <Icon name={action.icon} size={12} />
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            key={action.key}
            variant={action.danger ? 'destructive' : 'outline'}
            size="sm"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              action.onClick();
            }}
          >
            <Icon name={action.icon} size={13} />
            {busy === action.key || (refreshing && busy === null) ? 'Working…' : action.label}
          </Button>
        ),
      )}

      {error ? <span className="text-xs text-destructive">{error}</span> : null}

      <ConfirmDialog {...confirmProps} />
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
  const { confirmProps, ask } = useConfirm();

  if (count === 0) return null;

  const noun = count === 1 ? 'message' : 'messages';

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() =>
          ask({
            title: `Empty the bin?`,
            description: `${count} ${noun} and their attachments will be removed for good. This cannot be undone.`,
            confirmLabel: `Delete ${count} ${noun}`,
            destructive: true,
            onConfirm: async () => {
              await apiRequest('/api/v1/mail-bin', { method: 'DELETE' });
              router.refresh();
            },
          })
        }
      >
        <Icon name="delete" size={13} />
        Empty bin ({count})
      </Button>

      <ConfirmDialog {...confirmProps} />
    </>
  );
}
