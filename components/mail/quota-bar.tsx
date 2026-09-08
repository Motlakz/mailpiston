import { Icon } from '@/components/icon';

/**
 * Today's send usage against the provider's own daily limit.
 *
 * The bar is drawn only when the provider reports a limit. A bar with no
 * denominator would have to invent one, and the monthly allowance is the plan's
 * advertised figure — carried separately, never derived by multiplying the
 * daily number by thirty.
 */
export interface OutboundQuotaView {
  daily: { used: number; limit: number | null };
  monthlyAllowance: number | null;
}

export function QuotaBar({ quota }: { quota: OutboundQuotaView }) {
  const { used, limit } = quota.daily;
  const ratio = limit ? Math.min(used / limit, 1) : null;

  const tone =
    ratio === null || ratio < 0.75
      ? 'bg-success'
      : ratio < 0.95
        ? 'bg-warning'
        : 'bg-destructive';

  return (
    <section className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name="sent" size={13} />
        Sent today
      </span>

      <span className="font-mono text-xs">
        {used.toLocaleString()}
        {limit === null ? '' : ` / ${limit.toLocaleString()}`}
      </span>

      {ratio === null ? (
        <span className="text-xs text-muted-foreground">
          The provider reports no daily limit.
        </span>
      ) : (
        <span
          className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${Math.round(ratio * 100)}% of today's send limit used`}
        >
          <span
            className={`block h-full rounded-full ${tone}`}
            style={{ width: `${Math.max(ratio * 100, 2)}%` }}
          />
        </span>
      )}

      {quota.monthlyAllowance ? (
        <span className="text-xs text-muted-foreground">
          {quota.monthlyAllowance.toLocaleString()} / month on this plan
        </span>
      ) : null}
    </section>
  );
}
