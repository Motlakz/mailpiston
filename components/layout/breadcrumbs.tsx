'use client';

import { usePathname } from 'next/navigation';
import { Fragment } from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import { NAV_ITEMS } from './nav';

/**
 * Where you are, derived from the path.
 *
 * Derived rather than passed down, because a trail assembled by each page is a
 * trail that goes stale on the one page nobody revisits. The nav table already
 * names every section; this reuses it so a renamed section renames its
 * breadcrumb, and a section that is not in the nav still gets a sensible
 * title-cased segment rather than a gap.
 *
 * Detail segments are ids — `em_8Kq2…` — which are useless as a label and
 * worse as a lie. They render as the resource kind instead, and the page's own
 * heading carries the actual subject.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    const navItem = NAV_ITEMS.find((item) => item.href === href);

    return {
      href,
      label: navItem?.label ?? labelForSegment(segment),
      // Only the section a crumb points at is worth linking; an id segment has
      // no page of its own above the one being viewed.
      linkable: Boolean(navItem),
    };
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;

          return (
            <Fragment key={crumb.href}>
              <BreadcrumbItem>
                {last || !crumb.linkable ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href}>
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {last ? null : <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** Prefixed ids are ours and always look like this, so they are safe to detect. */
const ID_SEGMENT = /^[a-z]{2,5}_[A-Za-z0-9]{8,}$/;

function labelForSegment(segment: string): string {
  if (ID_SEGMENT.test(segment)) {
    const kind = segment.slice(0, segment.indexOf('_'));
    return RESOURCE_NAMES[kind] ?? 'Detail';
  }

  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const RESOURCE_NAMES: Record<string, string> = {
  em: 'Message',
  thr: 'Conversation',
  dom: 'Domain',
  addr: 'Address',
  ep: 'Endpoint',
  key: 'API key',
};
