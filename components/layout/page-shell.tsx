import type { ReactNode } from 'react';

import { Icon, type IconName } from '@/components/icon';
import { Separator } from '@/components/ui/separator';

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

          <div className="flex flex-wrap items-center">
            <h1 className="font-serif text-2xl mb-2 leading-tight tracking-tight text-balance">
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
          {/* Filters and search sit on a surface of their own. The heading above
              does not — a title needs the page, not a box. */}
          <div className="dashboard-page-toolbar flex flex-wrap items-center justify-between gap-3">
            {toolbar}
          </div>
        </>
      ) : (
        <Separator />
      )}
    </header>
  );
}

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
