import { Skeleton } from '@/components/ui/skeleton';

/**
 * What a dashboard page looks like while its data is in flight.
 *
 * Every list here is server-rendered from a live query, so navigating has a
 * real gap. Without a `loading.tsx` the old page simply sits there until the
 * new one is ready, which reads as a click that did nothing — and is exactly
 * the case `useLinkStatus` exists to paper over. A route-level fallback is the
 * better fix: it is instant, and it shows the *shape* of what is coming.
 *
 * Deliberately matched to the real layout — header block, then rows of the same
 * height. A generic spinner would be less work and would also throw away the
 * one thing a skeleton is for, which is that the page does not jump when the
 * content replaces it.
 */
export function PageSkeleton({
  rows = 6,
  toolbar = true,
  variant = 'table',
  action = true,
}: {
  rows?: number;
  /** Pages with filter tabs reserve the space for them. */
  toolbar?: boolean;
  variant?: 'table' | 'list' | 'timeline' | 'cards' | 'endpoints' | 'mail';
  action?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <SkeletonHeader toolbar={toolbar} action={action} />
      <SkeletonBody variant={variant} rows={rows} />
    </div>
  );
}

function SkeletonHeader({ toolbar, action }: { toolbar: boolean; action: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-4 w-[min(32rem,70vw)]" />
        </div>
        {action ? <Skeleton className="h-7 w-28" /> : null}
      </div>
      <Skeleton className="h-px w-full" />
      {toolbar ? <Skeleton className="h-14 w-full rounded-xl" /> : null}
    </div>
  );
}

function SkeletonBody({
  variant,
  rows,
}: {
  variant: 'table' | 'list' | 'timeline' | 'cards' | 'endpoints' | 'mail';
  rows: number;
}) {
  if (variant === 'mail') {
    return (
      <div className="grid min-h-112 grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)] overflow-hidden rounded-2xl border border-border max-[62rem]:grid-cols-1">
        <div className="border-r border-border max-[62rem]:border-r-0">
          <div className="flex h-22 flex-col justify-center gap-3 border-b border-border px-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-64" />
          </div>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex gap-3 border-b border-border p-4">
              <Skeleton className="size-8 shrink-0 rounded-lg" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
        <div className="max-[62rem]:hidden">
          <div className="flex h-22 flex-col justify-center gap-2 border-b border-border px-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-2/5" />
          </div>
          <div className="flex flex-col gap-5 p-6">
            <div className="flex gap-3"><Skeleton className="size-9 rounded-full" /><Skeleton className="h-8 w-56" /></div>
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'endpoints') {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-border max-md:grid-cols-1">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex h-28 flex-col justify-between border-l border-border p-4 first:border-l-0 max-md:border-t max-md:border-l-0 max-md:first:border-t-0">
              <Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
        {Array.from({ length: Math.min(rows, 3) }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-2xl border border-border">
            <div className="flex items-center gap-3 border-b border-border p-4"><Skeleton className="size-9 rounded-lg" /><Skeleton className="h-5 w-44" /></div>
            <div className="grid grid-cols-[1.2fr_1fr] max-md:grid-cols-1"><Skeleton className="m-4 h-20 rounded-lg" /><Skeleton className="m-4 h-20 rounded-lg" /></div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-2xl border border-border">
            <div className="flex items-center justify-between border-b border-border p-4"><Skeleton className="h-5 w-48" /><Skeleton className="h-6 w-28" /></div>
            <div className="flex flex-col gap-3 p-4"><Skeleton className="h-4 w-56" /><Skeleton className="h-20 w-full rounded-lg" /></div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'timeline') {
    return (
      <div className="flex flex-col gap-4 border-l border-border pl-6">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-xl border border-border p-4"><Skeleton className="h-3 w-32" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-5/6" /></div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {variant === 'table' ? (
        <div className="grid grid-cols-[1.3fr_1fr_.7fr_.7fr] gap-4 border-b border-border bg-muted/30 px-4 py-3"><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-16" /></div>
      ) : null}
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3.5 border-b border-border px-4 py-3.5 last:border-0"><Skeleton className="h-4 w-40 shrink-0" /><Skeleton className="h-4 min-w-0 flex-1" /><Skeleton className="h-4 w-20 shrink-0" /></div>
      ))}
    </div>
  );
}
