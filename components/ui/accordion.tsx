'use client';

import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * A disclosure panel, built rather than borrowed from `<details>`.
 *
 * `<details>` is semantically right and visually awkward: the marker is a
 * platform glyph that sits on a different baseline in every browser, and the
 * summary is a flex container that fights its own `display` in Safari. That is
 * what made the text look skewed. A button with `aria-expanded` gives the same
 * semantics to a screen reader and leaves the layout entirely ours.
 */
export function Accordion({
  title,
  children,
  defaultOpen = false,
  className,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={cn('accordion', className)} data-open={open ? '' : undefined}>
      <button
        type="button"
        className="accordion__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{title}</span>
        {/* Inline rather than added to the icon registry for a single use. */}
        <svg
          className="accordion__chevron"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>

      {/* Unmounted when closed rather than hidden: the panel holds headings and
          links, and a collapsed-but-present one is still in the tab order. */}
      {open ? (
        <div id={panelId} className="accordion__panel">
          {children}
        </div>
      ) : null}
    </div>
  );
}
