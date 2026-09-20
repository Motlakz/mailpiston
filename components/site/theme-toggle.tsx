'use client';

import { useEffect, useId, useSyncExternalStore } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { HugeiconsIcon } from '@hugeicons/react';
import { ComputerIcon, Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';

export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'mailpiston-theme';

/** Fired on the window when this tab changes the choice, so the store re-reads. */
const THEME_EVENT = 'mailpiston:theme';

/**
 * Three states, not two.
 *
 * A two-state switch silently overrides a preference the visitor already
 * expressed to their operating system — and keeps overriding it afterwards,
 * including after they change it. "Auto" is the default and stays available, so
 * the control can be given back.
 *
 * The three sit side by side as icons rather than as a single button that
 * cycles: the usual sun/moon switch is ambiguous by construction, since it
 * never says whether the icon is the current state or the one pressing it
 * would produce. Here the lit segment is the current state, and every
 * destination is one click away. The words each segment would otherwise carry
 * live in `aria-label` and the native tooltip instead of on the surface.
 */
export function ThemeToggle() {
  /**
   * The choice lives in `localStorage`, which is external state that React does
   * not own — so it is read through the primitive built for exactly that rather
   * than copied into component state by an effect. It also gets the
   * server/hydration mismatch right for free: the server renders "Auto", and
   * the real value arrives on the client's first commit.
   */
  const choice = useSyncExternalStore(subscribe, readChoice, () => 'system' as const);
  const reduceMotion = useReducedMotion();
  // The page renders this control more than once (header and footer). A shared
  // layout id would make framer-motion treat those as one element and slide the
  // lit segment between them, so each instance gets its own group.
  const group = useId();

  // Following the system means following it as it changes, not only as it was
  // when the page loaded. No state is set here — only the document class.
  useEffect(() => {
    if (choice !== 'system') return;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => applyTheme('system');

    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [choice]);

  function select(next: ThemeChoice) {
    applyTheme(next);

    try {
      if (next === 'system') {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    } catch {
      // Private mode, or storage disabled. The choice still applies to this
      // page view; it simply will not be remembered.
    }

    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <LayoutGroup id={group}>
      <div className="theme-toggle" data-choice={choice} role="group" aria-label="Colour theme">
        {OPTIONS.map(({ value, label, icon }) => (
          <button
            key={value}
            type="button"
            className="theme-toggle__option"
            aria-pressed={choice === value}
            aria-label={label}
            title={label}
            onClick={() => select(value)}
          >
            {choice === value && (
              <motion.span
                className="theme-toggle__thumb"
                layoutId={`${group}-thumb`}
                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <HugeiconsIcon icon={icon} size={15} strokeWidth={2} />
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

/** Ordered light → auto → dark, so the row reads as a brightness ramp. */
const OPTIONS = [
  { value: 'light', label: 'Light theme', icon: Sun03Icon },
  { value: 'system', label: 'Match system theme', icon: ComputerIcon },
  { value: 'dark', label: 'Dark theme', icon: Moon02Icon },
] as const satisfies ReadonlyArray<{ value: ThemeChoice; label: string; icon: unknown }>;

/** `storage` covers the same choice being made in another tab. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener('storage', onChange);

  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(choice: ThemeChoice): void {
  const dark =
    choice === 'dark' ||
    (choice === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

/**
 * The same decision, taken before first paint.
 *
 * This runs as a blocking inline script in `<head>`. Without it the document
 * paints light, React hydrates, and the theme snaps to dark — a flash that is
 * brief, impossible to avoid from a component, and the single most noticeable
 * bug a dark mode can have.
 *
 * Deliberately tiny and dependency-free: it needs one storage read and one
 * media query, and it must not throw on a browser where storage is blocked.
 */
export const THEME_INIT_SCRIPT = `
try {
  var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
  var dark = stored === 'dark' || (stored !== 'light' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
} catch (e) {}
`.trim();
