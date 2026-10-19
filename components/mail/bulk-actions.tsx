'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import { apiRequest } from '@/lib/api-client';
import { useOptimisticStore } from '@/lib/optimistic-store';

interface EmailPageCache {
  pages: Array<{ items: Array<{ id: string }>; nextCursor?: string | null }>;
  pageParams: Array<string | null>;
}

/** Views whose rows are all received mail, so every selection has a sender. */
const SENDER_VIEWS = new Set(['inbox', 'review', 'spam']);

export function BulkActions({ view }: { view: string }) {
  const binned = view === 'bin';
  const router = useRouter();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const { confirmProps, ask } = useConfirm();
  const selection = useOptimisticStore((state) => state.selected);
  const selected = Object.keys(selection);
  const applyEmail = useOptimisticStore((state) => state.applyEmail);
  const clearSelection = useOptimisticStore((state) => state.clearSelection);
  const clearAll = useOptimisticStore((state) => state.clearAll);

  if (selected.length === 0) return null;

  const count = selected.length;
  const noun = count === 1 ? 'message' : 'messages';

  async function run(action: 'bin' | 'purge' | 'trust' | 'block', verb: string) {
    setRunning(true);
    const ids = [...selected];
    // A sender decision only removes the row when it moves the message out of
    // this view: blocking from Spam leaves it in Spam.
    const leaves =
      action === 'trust'
        ? view === 'review' || view === 'spam'
        : action === 'block'
          ? view !== 'spam'
          : true;
    for (const id of ids) {
      if (!leaves) continue;
      applyEmail(id, action === 'bin' ? { binned: true, gone: true } : { gone: true });
    }

    try {
      const response = await apiRequest<{
        changed: number;
        senders?: number;
        failures: Array<{ id: string }>;
      }>('/api/v1/emails/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, action }),
      });

      const failedIds = new Set(response.failures.map((failure) => failure.id));
      const changedIds = leaves ? ids.filter((id) => !failedIds.has(id)) : [];

      queryClient.setQueriesData<EmailPageCache>(
        { queryKey: ['emails'] },
        (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((page) => ({
                  ...page,
                  items: page.items.filter((item) => !changedIds.includes(item.id)),
                })),
              }
            : current,
      );
      clearSelection();
      clearAll();
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      startTransition(() => router.refresh());

      const failed = response.failures.length;
      if (failed) {
        toast.error(
          `${verb}: ${response.changed} of ${count}. ${failed} could not be changed.`,
        );
      } else if (response.senders !== undefined) {
        toast(
          `${verb} — ${response.senders} ${response.senders === 1 ? 'sender' : 'senders'}.`,
          { description: 'Undo from Settings → Mail filtering.' },
        );
      } else {
        toast(`${verb} — ${response.changed} ${noun}.`);
      }
    } catch (error) {
      for (const id of ids) useOptimisticStore.getState().clearEmail(id);
      toast.error((error as Error).message || 'The bulk action failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bulk-actions" role="status">
      <span className="bulk-actions__count">{count} selected</span>

      {binned ? (
        <Button
          variant="destructive"
          size="sm"
          disabled={running}
          onClick={() =>
            ask({
              title: `Delete ${count} ${noun} permanently?`,
              description:
                'These messages and their attachments are removed for good. This cannot be undone.',
              confirmLabel: `Delete ${count} ${noun}`,
              destructive: true,
              onConfirm: () => run('purge', 'Deleted for good'),
            })
          }
        >
          <Icon name="delete" size={13} />
          {running ? 'Deleting…' : 'Delete forever'}
        </Button>
      ) : (
        <>
          {SENDER_VIEWS.has(view) && view !== 'inbox' ? (
            <Button
              variant="outline"
              size="sm"
              disabled={running}
              onClick={() => run('trust', 'Trusted')}
            >
              <Icon name="shield" size={13} />
              Trust senders
            </Button>
          ) : null}
          {SENDER_VIEWS.has(view) ? (
            <Button
              variant="outline"
              size="sm"
              disabled={running}
              className="hover:text-destructive"
              onClick={() => run('block', 'Blocked')}
            >
              <Icon name="spam" size={13} />
              Block senders
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={running}
            onClick={() => run('bin', 'Moved to the bin')}
          >
            <Icon name="delete" size={13} />
            {running ? 'Working…' : `Bin ${count}`}
          </Button>
        </>
      )}

      <Button variant="ghost" size="sm" disabled={running} onClick={clearSelection}>
        Clear
      </Button>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
