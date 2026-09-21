'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Application toasts.
 *
 * Colours come from our own tokens through Sonner's CSS variables rather than
 * from its `theme` prop. The prop only knows `light | dark | system`, and this
 * app has a third state — an explicit choice that overrides the system — so a
 * prop-driven toast would sit in the wrong palette exactly when someone has
 * gone to the trouble of picking one. Driving it from `--card`/`--foreground`
 * means it follows the `.dark` class like everything else, for free.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="app-toaster"
      position="bottom-right"
      // Long enough to read a sentence and reach the undo button, short enough
      // not to stack up while working through a list.
      duration={6000}
      gap={10}
      style={
        {
          '--normal-bg': 'var(--card)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
