'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * Sections arriving as they are scrolled to.
 *
 * `whileInView` with `once` rather than a scroll-linked progress value: the
 * landing page is long, and tying opacity to scroll position means content
 * fades back out when somebody scrolls up, which reads as a rendering fault
 * rather than as an effect.
 *
 * The margin fires the animation slightly *before* the section reaches the
 * viewport, so by the time it is actually being looked at it has finished
 * moving. A reveal you watch happen is a reveal that delayed you.
 *
 * Under `prefers-reduced-motion` it renders the children untouched — not a
 * faster animation, none at all. The section still has to be visible, so there
 * is no fallback where content could get stuck at zero opacity.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return className ? <div className={className}>{children}</div> : <>{children}</>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
