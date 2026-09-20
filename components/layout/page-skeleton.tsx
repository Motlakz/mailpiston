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
}: {
  rows?: number;
  /** Pages with filter tabs reserve the space for them. */
  toolbar?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-7 w-28" />
        </div>

        <Skeleton className="h-px w-full" />
        {toolbar ? <Skeleton className="h-8 w-72 rounded-lg" /> : null}
      </div>

      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-3.5 border-b border-border px-4 py-3.5 last:border-0"
          >
            <Skeleton className="h-4 w-40 shrink-0" />
            <Skeleton className="h-4 min-w-0 flex-1" />
            <Skeleton className="h-4 w-20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
