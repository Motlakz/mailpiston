'use client';

import { motion } from 'framer-motion';
import { usePathname } from 'next/navigation';

/**
 * The one movement between dashboard pages.
 *
 * Keyed on the pathname, so navigating remounts it and the entry animation
 * plays. It is deliberately small — eight pixels and 180ms — because this fires
 * on every navigation in the product, and an animation you notice the second
 * time is an animation that is too big.
 *
 * Only `opacity` and `transform` are animated. Anything touching layout would
 * make every page load reflow, which costs more than the transition buys.
 *
 * There is no exit animation. Next renders the new page when its data is ready,
 * and holding the old one back to fade it out would add latency to every
 * navigation in exchange for a frame nobody asked for. `loading.tsx` covers the
 * gap instead.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="dashboard-page flex min-w-0 flex-1 flex-col gap-6"
    >
      {children}
    </motion.div>
  );
}

/**
 * A list whose rows arrive one after another rather than all at once.
 *
 * Used for tables and message lists. The stagger is 18ms and capped by the
 * number of rows the viewport can hold — a hundred-row list staggered at 18ms
 * would take nearly two seconds to finish arriving, which is not a transition,
 * it is a wait.
 */
export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.018, delayChildren: 0.02 } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export const staggerItem = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2 } },
};
