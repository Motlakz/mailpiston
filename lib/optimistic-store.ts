import { create } from 'zustand';

/**
 * Client-held overlays on top of server-rendered rows.
 *
 * The lists on these screens are rendered by server components, so there is no
 * client cache holding a message for an optimistic write to edit — the markup
 * comes back from the server on `router.refresh()`. TanStack Query's cache
 * cannot stand in for that, because it never held the row in the first place.
 *
 * So the optimistic state lives beside the server data rather than inside it: a
 * mutation records what it *intends* here, every row and pane reads this store
 * and lets a matching entry win over its props, and the entry is dropped once
 * the refreshed server markup arrives carrying the real value. The overlay is
 * deliberately small — only the fields an action actually changes.
 */
export interface EmailOverlay {
  spamVerdict?: 'clean' | 'suspicious' | 'spam';
  binned?: boolean;
  /** Removed from the list entirely — a permanent delete, mid-flight. */
  gone?: boolean;
  /** Drives the row's own spinner, rather than a single global one. */
  pending: boolean;
}

interface OptimisticState {
  emails: Record<string, EmailOverlay>;
  /**
   * Checked rows, for acting on many messages at once.
   *
   * A map rather than a Set so a row can test its own membership with one key
   * lookup and re-render only when that key changes — a Set would make every
   * row a subscriber to the whole selection.
   */
  selected: Record<string, true>;
  toggleSelected: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  /** Apply, or extend what is already applied for this id. */
  applyEmail: (id: string, patch: Omit<EmailOverlay, 'pending'>) => void;
  markEmailSettled: (id: string) => void;
  clearEmail: (id: string) => void;
  /**
   * Dropped wholesale once fresh server markup lands: at that point every
   * overlay is either reflected in the new data or was rolled back on error,
   * and keeping any of it would mean showing a stale guess over a known truth.
   */
  clearAll: () => void;
}

export const useOptimisticStore = create<OptimisticState>((set) => ({
  emails: {},
  selected: {},

  toggleSelected: (id) =>
    set((state) => {
      const next = { ...state.selected };
      if (next[id]) delete next[id];
      else next[id] = true;
      return { selected: next };
    }),

  selectMany: (ids) =>
    set((state) => {
      // Already all selected means this is a "select none" — the usual
      // behaviour of a header checkbox that is currently ticked.
      const allSelected = ids.length > 0 && ids.every((id) => state.selected[id]);
      if (allSelected) return { selected: {} };
      return {
        selected: Object.fromEntries(ids.map((id) => [id, true as const])),
      };
    }),

  clearSelection: () =>
    set((state) => (Object.keys(state.selected).length ? { selected: {} } : state)),

  applyEmail: (id, patch) =>
    set((state) => ({
      emails: {
        ...state.emails,
        [id]: { ...state.emails[id], ...patch, pending: true },
      },
    })),

  markEmailSettled: (id) =>
    set((state) =>
      state.emails[id]
        ? {
            emails: {
              ...state.emails,
              [id]: { ...state.emails[id], pending: false },
            },
          }
        : state,
    ),

  clearEmail: (id) =>
    set((state) => {
      if (!state.emails[id]) return state;
      const next = { ...state.emails };
      delete next[id];
      return { emails: next };
    }),

  clearAll: () => set((state) => (Object.keys(state.emails).length ? { emails: {} } : state)),
}));

/**
 * The overlay for one message, or `undefined`.
 *
 * A selector rather than reading the whole map, so a row only re-renders when
 * its own entry changes — a hundred-row list subscribed to the entire store
 * would re-render all of it on every keystroke of progress.
 */
export function useEmailOverlay(id: string): EmailOverlay | undefined {
  return useOptimisticStore((state) => state.emails[id]);
}

/** Whether this one row is checked, without subscribing it to the rest. */
export function useIsSelected(id: string): boolean {
  return useOptimisticStore((state) => Boolean(state.selected[id]));
}
