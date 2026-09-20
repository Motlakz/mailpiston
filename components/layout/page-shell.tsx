import type { ReactNode } from 'react';

import { Icon, type IconName } from '@/components/icon';
import { Separator } from '@/components/ui/separator';

/**
 * Standard page header, so every dashboard page has the same shape.
 *
 * Three bands rather than two: title, then an optional description, then an
 * optional row of filters or tabs below a rule. The old version had the tabs
 * floating free underneath, which meant the gap between "what this page is" and
 * "which slice of it you are looking at" was the same gap as between the tabs
 * and the content — so the tabs read as belonging to the list rather than to
 * the page.
 *
 * `eyebrow` is for the parent a page belongs to when the breadcrumb is not
 * enough on its own, and `meta` for a count or a timestamp that qualifies the
 * title without competing with it.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  meta,
  toolbar,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
  meta?: ReactNode;
  /** Filters, tabs, or search. Sits below a rule, attached to the header. */
  toolbar?: ReactNode;
}) {
  return (
    <header className="dashboard-page-header flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
              {eyebrow}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-2xl leading-tight tracking-tight text-balance">
              {title}
            </h1>
            {meta}
          </div>

          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {toolbar ? (
        <>
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-3">
            {toolbar}
          </div>
        </>
      ) : (
        <Separator />
      )}
    </header>
  );
}

/**
 * The empty state every page ships with.
 *
 * It names the phase on purpose: an empty screen that explains why it is empty
 * is a status report, and one that does not is a bug report waiting to happen.
 */
export function EmptyState({
  icon,
  title,
  description,
  phase,
  children,
}: {
  icon: IconName;
  title: string;
  description: string;
  phase?: string;
  children?: ReactNode;
}) {
  return (
    <div className="dashboard-empty-state flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name={icon} size={18} />
      </span>

      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
          {description}
        </p>
      </div>

      {phase ? (
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          Lands in {phase}
        </span>
      ) : null}

      {children}
    </div>
  );
}
