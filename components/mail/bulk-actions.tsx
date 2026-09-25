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

export function BulkActions({ binned = false }: { binned?: boolean }) {
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

  async function run(action: 'bin' | 'purge', verb: string) {
    setRunning(true);
    const ids = [...selected];
    for (const id of ids) {
      applyEmail(id, action === 'bin' ? { binned: true, gone: true } : { gone: true });
    }

    try {
      const response = await apiRequest<{
        changed: number;
        failures: Array<{ id: string }>;
      }>('/api/v1/emails/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, action }),
      });

      const failedIds = new Set(response.failures.map((failure) => failure.id));
      const changedIds = ids.filter((id) => !failedIds.has(id));

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
        <Button
          variant="outline"
          size="sm"
          disabled={running}
          onClick={() => run('bin', 'Moved to the bin')}
        >
          <Icon name="delete" size={13} />
          {running ? 'Binning…' : `Bin ${count}`}
        </Button>
      )}

      <Button variant="ghost" size="sm" disabled={running} onClick={clearSelection}>
        Clear
      </Button>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
