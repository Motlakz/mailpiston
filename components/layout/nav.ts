import type { IconName } from '@/components/icon';

/**
 * The nine navigation items from execution plan §20, in that order, with
 * `/overview` standing in for "Overview" because `/` is the marketing page.
 *
 * §20 is explicit about what does not belong here: no billing, plans,
 * organisations, seats, campaigns, CRM, or permissions. This is a focused
 * developer utility for one operator.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  group: 'mail' | 'config' | 'account';
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/overview', label: 'Overview', icon: 'overview', group: 'mail' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox', group: 'mail' },
  { href: '/sent', label: 'Sent', icon: 'sent', group: 'mail' },
  { href: '/threads', label: 'Threads', icon: 'threads', group: 'mail' },
  { href: '/logs', label: 'Logs', icon: 'logs', group: 'mail' },

  { href: '/domains', label: 'Domains', icon: 'domains', group: 'config' },
  { href: '/addresses', label: 'Addresses', icon: 'addresses', group: 'config' },
  { href: '/endpoints', label: 'Endpoints', icon: 'endpoints', group: 'config' },

  { href: '/api-keys', label: 'API Keys', icon: 'apiKeys', group: 'account' },
  { href: '/settings', label: 'Settings', icon: 'settings', group: 'account' },
];
