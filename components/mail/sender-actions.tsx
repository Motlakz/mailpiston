'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { apiRequest, messageFor } from '@/lib/api-client';
import { useOptimisticStore } from '@/lib/optimistic-store';

type Decision = 'trust' | 'block';
type Scope = 'address' | 'domain';

export interface SenderStanding {
  /** Where the sender already sits on the lists, so the opposite is offered. */
  standing: 'trusted' | 'blocked' | null;
  domain: string | null;
  canTrustDomain: boolean;
  canBlockDomain: boolean;
}

export function SenderActions({
  emailId,
  flagged,
  sender,
  leavesView,
  compact = false,
}: {
  emailId: string;
  /** Suspicious or quarantined: the only mail where "trust" is worth offering. */
  flagged: boolean;
  sender: SenderStanding;
  /** Whether each decision moves this message out of the list on screen. */
  leavesView?: Partial<Record<Decision, boolean>>;
  /** Icon buttons for list rows; labelled buttons for the reading pane. */
  compact?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [, startTransition] = useTransition();
  const { confirmProps, ask } = useConfirm();
  const applyEmail = useOptimisticStore((state) => state.applyEmail);
  const clearEmail = useOptimisticStore((state) => state.clearEmail);

  async function decide(decision: Decision, scope: Scope) {
    setBusy(decision);
    if (leavesView?.[decision]) applyEmail(emailId, { gone: true });

    try {
      const { pattern, moved } = await apiRequest<{ pattern: string; moved: number }>(
        `/api/v1/emails/${emailId}/sender`,
        { method: 'POST', body: JSON.stringify({ decision, scope }) },
      );

      const others = Math.max(0, moved - 1);
      toast(
        decision === 'trust'
          ? `Trusted ${pattern}.${others ? ` ${others} more released.` : ''}`
          : `Blocked ${pattern}. Their next message will be refused.`,
        { description: 'Undo from Settings → Mail filtering.' },
      );

      // Other mail from this sender moved too, so every cached page is stale.
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      startTransition(() => router.refresh());
    } catch (caught) {
      clearEmail(emailId);
      toast.error(messageFor(caught));
    } finally {
      setBusy(null);
    }
  }

  const blockDomain = () =>
    ask({
      title: `Block everyone at ${sender.domain}?`,
      description: `Mail from any address at ${sender.domain} or its subdomains will be refused without being stored. Addresses you trust individually still get through.`,
      confirmLabel: `Block ${sender.domain}`,
      destructive: true,
      onConfirm: () => decide('block', 'domain'),
    });

  const offerTrust = sender.standing !== 'trusted' && (flagged || sender.standing === 'blocked');
  const offerBlock = sender.standing !== 'blocked';

  if (compact) {
    return (
      <span className="flex items-center gap-0.5">
        {offerTrust ? (
          <QuickButton
            label="Trust sender"
            icon="shield"
            disabled={busy !== null}
            onClick={() => decide('trust', 'address')}
          />
        ) : null}
        {offerBlock ? (
          <QuickButton
            label="Block sender"
            icon="spam"
            danger
            disabled={busy !== null}
            onClick={() => decide('block', 'address')}
          />
        ) : null}
      </span>
    );
  }

  const domainMenu = sender.domain && (
    (offerTrust && sender.canTrustDomain) || (offerBlock && sender.canBlockDomain)
  );

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {offerTrust ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => decide('trust', 'address')}
        >
          <Icon name="shield" size={13} />
          {busy === 'trust' ? 'Trusting…' : 'Trust sender'}
        </Button>
      ) : null}

      {offerBlock ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          className="hover:text-destructive"
          onClick={() => decide('block', 'address')}
        >
          <Icon name="spam" size={13} />
          {busy === 'block' ? 'Blocking…' : 'Block sender'}
        </Button>
      ) : null}

      {domainMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy !== null}
                aria-label={`More options for ${sender.domain}`}
              />
            }
          >
            <Icon name="more" size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {offerTrust && sender.canTrustDomain ? (
              <DropdownMenuItem onClick={() => decide('trust', 'domain')}>
                <Icon name="shield" size={13} />
                Trust everyone at {sender.domain}
              </DropdownMenuItem>
            ) : null}
            {offerBlock && sender.canBlockDomain ? (
              <DropdownMenuItem variant="destructive" onClick={blockDomain}>
                <Icon name="spam" size={13} />
                Block everyone at {sender.domain}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <ConfirmDialog {...confirmProps} />
    </span>
  );
}

function QuickButton({
  label,
  icon,
  danger = false,
  disabled,
  onClick,
}: {
  label: string;
  icon: 'shield' | 'spam';
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={label}
            className={
              danger
                ? 'text-muted-foreground hover:text-destructive'
                : 'text-muted-foreground hover:text-foreground'
            }
            onClick={(event) => {
              // Rows are links. Without this, acting on a sender opens the message.
              event.preventDefault();
              event.stopPropagation();
              onClick();
            }}
          />
        }
      >
        <Icon name={icon} size={12} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
