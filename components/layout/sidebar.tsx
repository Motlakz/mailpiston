'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { usePersistedFlag } from '@/hooks/use-persisted-flag';
import { cn } from '@/lib/utils';
import { BrandWordmark } from '@/components/site/brand';
import mark from '@/public/mailpistonlogo-2.png';

import { NAV_ITEMS, type NavItem } from './nav';

const GROUP_LABELS: Record<NavItem['group'], string> = {
  mail: 'Mail',
  config: 'Configuration',
  account: 'Account',
  help: 'Help',
};

/** `help` is absent on purpose: it is pinned to the bottom, outside the groups. */
const GROUP_ORDER: NavItem['group'][] = ['mail', 'config', 'account'];

export const SIDEBAR_STORAGE_KEY = 'mailpiston-sidebar-collapsed';

/**
 * The dashboard sidebar, collapsible.
 *
 * Collapsed, it keeps the icons and moves every label into a tooltip. That is
 * the whole point of the collapse: an icon rail the operator cannot read is a
 * worse sidebar, not a smaller one.
 *
 * **Why the width is CSS and not a motion prop.** The collapsed preference
 * lives in `localStorage`, which the server cannot see, so a React-driven width
 * renders expanded and then animates shut on every single page load — the
 * sidebar appears to be deciding something. Instead `SIDEBAR_INIT_SCRIPT` puts
 * the state on `<html>` before first paint and CSS transitions the width, so
 * there is nothing to correct after hydration. Labels are hidden the same way
 * and for the same reason: unmounting them on a client-only boolean would flash
 * them on every load.
 *
 * Motion still owns what it is good at — the active indicator travelling
 * between items, and the chevron — because those are driven by state React
 * genuinely owns.
 */
export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = usePersistedFlag(SIDEBAR_STORAGE_KEY);

  function toggle() {
    const next = !collapsed;
    // The attribute is what CSS reads; storage is what the next load reads.
    document.documentElement.dataset.sidebar = next ? 'collapsed' : 'expanded';
    setCollapsed(next);
  }

  const docs = NAV_ITEMS.find((item) => item.group === 'help');

  return (
    <nav data-slot="sidebar" aria-label="Dashboard">
      <div className="sidebar-head">
        <Link href="/overview" className="sidebar-brand" aria-label="Overview">
          <Image src={mark} alt="" aria-hidden className="brand-mark" priority />
          {/* Hidden by CSS on the collapsed rail, where only the mark fits. */}
          <BrandWordmark />
        </Link>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggle}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!collapsed}
              />
            }
          >
            <motion.span
              animate={{ rotate: collapsed ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="flex"
            >
              <Icon name="panelLeft" size={15} />
            </motion.span>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="sidebar-scroll">
        {GROUP_ORDER.map((group) => (
          <div key={group} className="flex flex-col gap-0.5">
            {/* The group label has no icon to fall back on, so collapsed it
                becomes a rule. Both are always rendered; CSS picks one. */}
            <p className="sidebar-group-label">{GROUP_LABELS[group]}</p>
            <Separator className="sidebar-group-rule" />

            {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                collapsed={collapsed}
                pathname={pathname}
              />
            ))}
          </div>
        ))}
      </div>

      {docs ? (
        <div className="sidebar-foot">
          <Separator className="mb-1.5" />
          <SidebarLink item={docs} collapsed={collapsed} pathname={pathname} />
        </div>
      ) : null}
    </nav>
  );
}

function SidebarLink({
  item,
  collapsed,
  pathname,
}: {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
}) {
  // Prefix match so a detail page keeps its section highlighted.
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Tooltip
      // Rendered either way so the tree does not change shape on hydration;
      // it simply does nothing while there is a visible label to read.
      disabled={!collapsed}
    >
      <TooltipTrigger
        render={
          <Link
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn('sidebar-link', active && 'is-active')}
          />
        }
      >
        {active ? (
          <motion.span
            layoutId="sidebar-active"
            className="absolute inset-0 rounded-md bg-secondary"
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          />
        ) : null}

        <Icon name={item.icon} size={15} className="relative z-10 shrink-0" />
        <span className="sidebar-label">{item.label}</span>
      </TooltipTrigger>

      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The collapsed state, applied before first paint.
 *
 * Same technique as the theme script and for the same reason: a preference the
 * server cannot know has to be on the document before anything renders, or the
 * correction is visible. Runs blocking in `<head>`.
 */
export const SIDEBAR_INIT_SCRIPT = `
try {
  document.documentElement.dataset.sidebar =
    localStorage.getItem('${SIDEBAR_STORAGE_KEY}') === 'true'
      ? 'collapsed' : 'expanded';
} catch (e) {}
`.trim();
