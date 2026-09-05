'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon } from '@/components/icon';
import { cn } from '@/lib/utils';
import logo from '@/public/mailpistonlogo.png';

import { NAV_ITEMS, type NavItem } from './nav';

const GROUP_LABELS: Record<NavItem['group'], string> = {
  mail: 'Mail',
  config: 'Configuration',
  account: 'Account',
};

const GROUP_ORDER: NavItem['group'][] = ['mail', 'config', 'account'];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard"
      className="flex h-full w-56 shrink-0 flex-col gap-6 border-r border-border bg-card/60 px-3 py-5"
    >
      <Link href="/overview" className="px-2">
        {/* Wordmark: the logo already says the name. */}
        <Image src={logo} alt="MailPiston" className="h-11 w-auto rounded-xl" priority />
      </Link>

      {GROUP_ORDER.map((group) => (
        <div key={group} className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
            {GROUP_LABELS[group]}
          </p>

          {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
            // Prefix match so a detail page keeps its section highlighted.
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon name={item.icon} size={15} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
