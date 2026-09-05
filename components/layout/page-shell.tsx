import type { ReactNode } from 'react';

import { Icon, type IconName } from '@/components/icon';

/** Standard page header, so every dashboard page has the same shape. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div>
        <h1 className="font-serif text-2xl tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * The empty state every page ships with before its phase lands.
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name={icon} size={18} />
      </span>

      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
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
