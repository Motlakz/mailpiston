'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * A boolean the browser remembers.
 *
 * `localStorage` is state React does not own, so it is read through the
 * primitive built for exactly that rather than copied into component state by
 * an effect. Reading it in an effect works, but it is a cascading render on
 * every mount and the lint rule that forbids it is right.
 *
 * It also gets server rendering right for free: `getServerSnapshot` returns the
 * fallback, so the markup is deterministic and the stored value arrives on the
 * client's first commit.
 *
 * The `storage` event covers the same preference being changed in another tab;
 * the custom event covers this one, since `storage` does not fire in the tab
 * that wrote the value.
 */
export function usePersistedFlag(
  key: string,
  fallback = false,
): readonly [boolean, (next: boolean) => void] {
  const eventName = `mailpiston:flag:${key}`;

  const subscribe = useCallback(
    (onChange: () => void) => {
      window.addEventListener(eventName, onChange);
      window.addEventListener('storage', onChange);

      return () => {
        window.removeEventListener(eventName, onChange);
        window.removeEventListener('storage', onChange);
      };
    },
    [eventName],
  );

  const getSnapshot = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === 'true';
    } catch {
      // Private mode, or storage disabled.
      return fallback;
    }
  }, [key, fallback]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Not remembered; the dispatch below still applies it for this session.
      }
      window.dispatchEvent(new Event(eventName));
    },
    [key, eventName],
  );

  return useMemo(() => [value, set] as const, [value, set]);
}
