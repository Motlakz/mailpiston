'use client';

import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ApiRequestError } from '@/lib/api-client';

/**
 * One confirmation, used everywhere something cannot be undone.
 *
 * It replaces `window.confirm`, which the destructive paths were using. That
 * had three problems worth naming, because they are the reasons this file
 * exists rather than being a matter of taste.
 *
 * It is unstyleable and looks like a browser error, which is the wrong register
 * for "you are about to delete four thousand messages". It blocks the main
 * thread, so nothing can show progress and the window is frozen while the
 * request runs. And it cannot report failure — the call returns a boolean, the
 * request happens afterwards, and if it throws there is nowhere to say so.
 *
 * So this one owns the whole interaction: confirm, run, show progress, and keep
 * the dialog open on failure with the error in it. A destructive action that
 * silently failed and closed would leave the operator believing it worked.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);

    try {
      await onConfirm();
      onOpenChange(false);
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
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-request would leave the operator with no idea whether it
        // finished, so the dialog holds until the call settles.
        if (busy) return;
        setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => {
              // Not awaited: the dialog stays mounted and shows progress, and
              // `run` owns closing on success and holding open on failure.
              void run();
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The state a confirmation needs, so a caller is three lines rather than ten.
 *
 * Returns the props for the dialog plus an `ask` to open it. The action is
 * captured at `ask` time rather than at render, which is what lets one dialog
 * instance serve a whole table of rows.
 */
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    description: React.ReactNode;
    confirmLabel?: string;
    destructive?: boolean;
    onConfirm: () => Promise<unknown>;
  }>({
    open: false,
    title: '',
    description: '',
    onConfirm: async () => {},
  });

  return {
    confirmProps: {
      ...state,
      onOpenChange: (open: boolean) => setState((prev) => ({ ...prev, open })),
    },
    ask(options: {
      title: string;
      description: React.ReactNode;
      confirmLabel?: string;
      destructive?: boolean;
      onConfirm: () => Promise<unknown>;
    }) {
      setState({ ...options, open: true });
    },
  };
}
