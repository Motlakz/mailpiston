import Link from 'next/link';

import { Icon } from '@/components/icon';

export function TablePagination({
  page,
  itemCount,
  noun,
  plural,
  previousHref,
  nextHref,
}: {
  page: number;
  itemCount: number;
  noun: string;
  plural?: string;
  previousHref: string | null;
  nextHref: string | null;
}) {
  if (!previousHref && !nextHref) return null;

  return (
    <nav className="table-pagination" aria-label={`${noun} pagination`}>
      <p>
        <span>Page {page}</span>
        <span aria-hidden>·</span>
        <span>
          {itemCount} {itemCount === 1 ? noun : (plural ?? `${noun}s`)}
        </span>
      </p>

      <div>
        {previousHref ? (
          <Link href={previousHref} scroll={false}>
            <Icon name="arrowLeft" size={13} />
            Previous
          </Link>
        ) : (
          <span aria-disabled="true">
            <Icon name="arrowLeft" size={13} />
            Previous
          </span>
        )}

        {nextHref ? (
          <Link href={nextHref} scroll={false}>
            Next
            <Icon name="arrowRight" size={13} />
          </Link>
        ) : (
          <span aria-disabled="true">
            Next
            <Icon name="arrowRight" size={13} />
          </span>
        )}
      </div>
    </nav>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

export function cursorPageLinks({
  pathname,
  params,
  nextCursor,
  cursorParam = 'cursor',
  trailParam = 'cursorTrail',
}: {
  pathname: string;
  params: SearchParams;
  nextCursor: string | null;
  cursorParam?: string;
  trailParam?: string;
}): { page: number; previousHref: string | null; nextHref: string | null } {
  const currentCursor = one(params[cursorParam]);
  const trail = many(params[trailParam]);
  const base = copyWithout(params, new Set([cursorParam, trailParam]));

  const previous = currentCursor
    ? (() => {
        const previousParams = new URLSearchParams(base);
        const previousTrail = trail.slice(0, -1);
        for (const cursor of previousTrail) previousParams.append(trailParam, cursor);
        const previousCursor = trail.at(-1);
        if (previousCursor) previousParams.set(cursorParam, previousCursor);
        return href(pathname, previousParams);
      })()
    : null;

  const next = nextCursor
    ? (() => {
        const nextParams = new URLSearchParams(base);
        for (const cursor of trail) nextParams.append(trailParam, cursor);
        if (currentCursor) nextParams.append(trailParam, currentCursor);
        nextParams.set(cursorParam, nextCursor);
        return href(pathname, nextParams);
      })()
    : null;

  return {
    page: currentCursor ? trail.length + 2 : 1,
    previousHref: previous,
    nextHref: next,
  };
}

export function numberedPageLinks({
  pathname,
  params,
  page,
  totalPages,
  pageParam = 'page',
}: {
  pathname: string;
  params: SearchParams;
  page: number;
  totalPages: number;
  pageParam?: string;
}): { previousHref: string | null; nextHref: string | null } {
  const base = copyWithout(params, new Set([pageParam]));
  const linkFor = (target: number) => {
    const next = new URLSearchParams(base);
    if (target > 1) next.set(pageParam, String(target));
    return href(pathname, next);
  };

  return {
    previousHref: page > 1 ? linkFor(page - 1) : null,
    nextHref: page < totalPages ? linkFor(page + 1) : null,
  };
}

export function pageNumber(value: string | string[] | undefined): number {
  const parsed = Number(one(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function copyWithout(params: SearchParams, excluded: Set<string>): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (excluded.has(key) || raw === undefined) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) result.append(key, value);
  }
  return result;
}

function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first || undefined;
}

function many(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function href(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
