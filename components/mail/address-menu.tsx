'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

export function AddressMenu({
  addressId,
  email,
  enabled,
  canSend,
}: {
  addressId: string;
  email: string;
  enabled: boolean;
  canSend: boolean;
}) {
  const router = useRouter();
  const { confirmProps, ask } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function patch(body: Record<string, unknown>) {
    setError(null);
    setBusy(true);

    try {
      await apiRequest(`/api/v1/addresses/${addressId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'Something went wrong. Check the server logs.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={busy}
              aria-label={`More actions for ${email}`}
            />
          }
        >
          <Icon name="more" size={14} />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onClick={() => patch({ enabled: !enabled })}>
            <Icon name={enabled ? 'close' : 'verified'} size={13} />
            {enabled ? 'Disable' : 'Enable'}
          </DropdownMenuItem>

          {canSend ? null : (
            <DropdownMenuItem
              onClick={() =>
                ask({
                  title: `Enable sending for ${email}?`,
                  // Not a flag flip: it creates a concrete alias at the
                  // provider, which is what authorises the From: header.
                  description:
                    'This creates a dedicated alias at the provider, which is what lets mail be sent as this address. The address keeps receiving exactly as it does now.',
                  confirmLabel: 'Enable sending',
                  onConfirm: () => patch({ canSend: true }),
                })
              }
            >
              <Icon name="sent" size={13} />
              Enable sending
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              ask({
                title: `Delete ${email}?`,
                description:
                  'This removes the provider alias as well, so mail sent to this address will stop arriving. Messages already received are kept. Disabling it instead is reversible.',
                confirmLabel: 'Delete address',
                destructive: true,
                onConfirm: async () => {
                  await apiRequest(`/api/v1/addresses/${addressId}`, {
                    method: 'DELETE',
                  });
                  startTransition(() => router.refresh());
                },
              })
            }
          >
            <Icon name="delete" size={13} />
            Delete address
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? <span className="text-xs text-destructive">{error}</span> : null}

      <ConfirmDialog {...confirmProps} />
    </>
  );
}
