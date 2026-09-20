import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Every state in the product, rendered one way.
 *
 * Before this there were five badge implementations — domain status, email
 * status, webhook-key state, spam verdict, delivery status — each with its own
 * inline `Record<Status, string>` of Tailwind classes. They drifted, as parallel
 * lists do: some had borders, some did not, the greens disagreed, and a couple
 * were `text-[11px]` against everything else's `text-xs`.
 *
 * The tone is derived from the value rather than passed in, so a new status
 * cannot be added without deciding what it means. `unknown` values fall through
 * to `muted`, which is the honest rendering of "we have no opinion about this".
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'muted' | 'info';

const TONE_BY_STATUS: Record<string, StatusTone> = {
  // Domains
  verified: 'success',
  pending: 'warning',
  failed: 'danger',
  disabled: 'muted',

  // Messages
  received: 'muted',
  queued: 'warning',
  sent: 'success',
  delivered: 'success',
  soft_bounced: 'warning',
  hard_bounced: 'danger',

  // Deliveries
  delivering: 'warning',

  // Classification
  clean: 'success',
  suspicious: 'warning',
  spam: 'danger',

  // Webhook keys
  stored: 'success',
  unreadable: 'danger',
  fallback: 'muted',

  // Reconciliation
  ok: 'success',
  drift: 'warning',
  missing: 'danger',
  error: 'danger',
};

const TONE_VARIANT: Record<StatusTone, 'success' | 'warning' | 'danger' | 'muted' | 'outline'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  muted: 'muted',
  info: 'outline',
};

export function toneFor(status: string): StatusTone {
  return TONE_BY_STATUS[status] ?? 'muted';
}

export function StatusBadge({
  status,
  label,
  tone,
  className,
  title,
}: {
  status: string;
  /** Defaults to the status with underscores turned back into spaces. */
  label?: string;
  /** Overrides the derived tone, for the rare status that means two things. */
  tone?: StatusTone;
  className?: string;
  title?: string;
}) {
  const resolved = tone ?? toneFor(status);

  return (
    <Badge
      variant={TONE_VARIANT[resolved]}
      title={title}
      // `whitespace-nowrap` and a fixed height keep a badge from changing a
      // table row's height when its label is two words instead of one.
      className={cn('shrink-0 whitespace-nowrap', className)}
    >
      {label ?? status.replace(/_/g, ' ')}
    </Badge>
  );
}

/**
 * A badge with a dot instead of a fill, for places where a solid one would
 * dominate — a card header beside a domain name, say, where the name is the
 * thing being read and the status is the annotation.
 */
export function StatusDot({
  status,
  label,
  tone,
  className,
}: {
  status: string;
  label?: string;
  tone?: StatusTone;
  className?: string;
}) {
  const resolved = tone ?? toneFor(status);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', DOT_TONE[resolved])}
      />
      {label ?? status.replace(/_/g, ' ')}
    </span>
  );
}

const DOT_TONE: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  muted: 'bg-muted-foreground/50',
  info: 'bg-accent',
};
