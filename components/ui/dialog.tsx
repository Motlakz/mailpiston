'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';

import { Icon } from '@/components/icon';

/**
 * A centred modal, styled to match the dashboard.
 *
 * Anything that is more than one row of inputs belongs in here rather than in a
 * page header's action slot. A form that expands in place pushes the page
 * around it, and a header is the worst place for that to happen — the content
 * the operator was reading moves down the screen the moment they click.
 *
 * Controlled rather than trigger-driven, because every form using it needs to
 * close itself after a successful request, and some need to stay open to show
 * something the request returned.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />

        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-[0_28px_80px_rgba(28,46,50,0.18)] outline-none transition-all duration-200 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
            <div>
              <DialogPrimitive.Title className="font-serif text-base tracking-tight">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>

            <DialogPrimitive.Close
              aria-label="Close"
              className="-mr-1 -mt-0.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon name="close" size={14} />
            </DialogPrimitive.Close>
          </div>

          <div className="px-5 py-4">{children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
