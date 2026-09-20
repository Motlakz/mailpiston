'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useLinkStatus } from 'next/link';

import { cn } from '@/lib/utils';

export interface NavTab {
  key: string;
  href: string;
  label: string;
  /** Rendered as a count pill after the label. Omit for no count. */
  count?: number;
}

/**
 * The dashboard's filter tabs.
 *
 * These are *navigation*, not a client-side tab widget: each one is a URL, so a
 * filtered view can be linked, bookmarked and shared, and the list is fetched on
 * the server for the filter that is actually active. That rules out
 * `<Tabs>`/`<TabsTrigger>` directly — those own selection state and render
 * buttons — so this reproduces the same visual contract over `<Link>`s.
 *
 * The bug it replaces: the old tabs painted the active item `bg-foreground
 * text-background`, a hard black lozenge that read as a redaction bar rather
 * than a selection, and swallowed anything sitting under it. The active state
 * here is a raised surface, the way the rest of the product marks selection.
 *
 * The indicator is one shared element animated between tabs with a layout
 * animation, rather than a background that appears and disappears per tab —
 * which is what makes switching read as a single object moving instead of two
 * things blinking.
 */
export function NavTabs({
  tabs,
  active,
  'aria-label': ariaLabel,
  className,
}: {
  tabs: NavTab[];
  active: string;
  'aria-label': string;
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        'inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-0.75',
        className,
      )}
    >
      {tabs.map((tab) => (
        <NavTabLink key={tab.key} tab={tab} active={tab.key === active} />
      ))}
    </nav>
  );
}

function NavTabLink({ tab, active }: { tab: NavTab; active: boolean }) {
  return (
    <Link
      href={tab.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        active
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active ? (
        <motion.span
          // One element, shared across every tab in the row: `layoutId` is what
          // lets it travel rather than cross-fade.
          layoutId="nav-tab-indicator"
          className="absolute inset-0 rounded-md bg-background ring-1 ring-foreground/10"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      ) : null}

      <span className="relative z-10">{tab.label}</span>

      {tab.count !== undefined ? (
        <span
          className={cn(
            'relative z-10 tabular-nums transition-colors',
            active ? 'text-muted-foreground' : 'text-muted-foreground/70',
          )}
        >
          {tab.count}
        </span>
      ) : null}

      <PendingDot />
    </Link>
  );
}

/**
 * Feedback while the next filter is being fetched.
 *
 * These lists are dynamic and server-rendered, so a click has a real gap before
 * anything changes. `useLinkStatus` only reports pending when the route was not
 * already prefetched, so on a warm tab this never appears — which is correct:
 * an indicator that flashes on an instant navigation is noise.
 *
 * Always rendered and toggled by opacity, because mounting it on pending would
 * shift the row's layout at exactly the moment the eye is on it. But it is
 * positioned *absolutely* rather than left in the flex flow: in the flow its
 * 4px box plus the row's 6px gap reserved ten permanent pixels to the right of
 * every label, which pushed the text off-centre inside the active lozenge and
 * read as a lopsided tab. Out of the flow it costs nothing when hidden and
 * still shifts nothing when it appears.
 *
 * It sits inside the tab's own right padding, so it never collides with the
 * label or the count.
 */
function PendingDot() {
  const { pending } = useLinkStatus();

  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute top-1/2 right-1 z-10 size-1 -translate-y-1/2 rounded-full bg-current"
      initial={false}
      animate={{ opacity: pending ? 1 : 0, scale: pending ? 1 : 0.4 }}
      transition={{ duration: 0.15 }}
    />
  );
}
