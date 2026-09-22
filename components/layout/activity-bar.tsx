'use client';

import { useOptimisticStore } from '@/lib/optimistic-store';

/**
 * A thin progress rail across the top of the workspace while a write is in
 * flight.
 *
 * The per-row spinner says *that* row is busy; this says the application is.
 * They answer different questions, and the second one was the missing half —
 * an action taken from the reading pane, or one whose row has scrolled out of
 * view, otherwise produced no visible change anywhere until the server came
 * back.
 *
 * It is indeterminate on purpose. The duration is a server round trip whose
 * length we do not know, and a bar that animates to 90% and waits is a lie
 * people learn to distrust.
 */
export function ActivityBar() {
  const busy = useOptimisticStore((state) =>
    Object.values(state.emails).some((overlay) => overlay.pending),
  );

  return (
    <div
      className="activity-bar"
      data-busy={busy ? '' : undefined}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden />
      <span className="sr-only">{busy ? 'Saving…' : ''}</span>
    </div>
  );
}
