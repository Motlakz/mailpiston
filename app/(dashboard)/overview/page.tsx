import Link from 'next/link';

import { Icon } from '@/components/icon';
import { PageHeader } from '@/components/layout/page-shell';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { repositoriesFor } from '@/server/repositories';
import { requireOperatorPage } from '@/server/core/auth';

export const metadata = { title: 'Overview · MailPiston' };

/**
 * Counts of what exists, and nothing else.
 *
 * Message volume, delivery health, and the outbound-quota meter (roadmap §1.1 —
 * outbound volume, not domain count, is the binding limit) arrive with the
 * phases that produce those numbers. A tile showing a hardcoded zero would be
 * indistinguishable from a broken one.
 */
export default async function OverviewPage() {
  const { tenantId } = await requireOperatorPage();
  const repositories = repositoriesFor(tenantId);
  const [domains, addresses] = await Promise.all([
    repositories.domains.list(),
    repositories.addresses.list(),
  ]);

  const verified = domains.filter((domain) => domain.status === 'verified').length;
  const sendCapable = addresses.filter((address) => address.canSend).length;

  return (
    <>
      <PageHeader
        title="Overview"
        description="One operator, every domain you manage, one control plane."
      />

      <div className="overview-stats grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Domains" value={domains.length} href="/domains" icon="domains" tone="blue" />
        <Stat label="Verified" value={verified} href="/domains" icon="verified" tone="green" />
        <Stat
          label="Addresses"
          value={addresses.length}
          href="/addresses"
          icon="addresses"
          tone="pink"
        />
        <Stat
          label="Send-capable"
          value={sendCapable}
          href="/addresses"
          icon="sent"
          tone="orange"
        />
      </div>

      <div className="overview-control-grid">
        <Card className="overview-route-map p-0">
          <div className="overview-card-head">
            <div>
              <p className="overview-kicker">Live architecture</p>
              <h2>One path from domain to reply.</h2>
            </div>
            <StatusBadge
              status={verified > 0 ? 'verified' : 'pending'}
              label={verified > 0 ? 'ready' : 'setup required'}
            />
          </div>
          <div className="overview-route-stage" aria-label="Mail routing architecture">
            <RouteNode icon="domains" overline="Public edge" value={`${domains.length} ${domains.length === 1 ? 'domain' : 'domains'}`} className="overview-route-node--domain" />
            <RouteNode icon="overview" overline="Control plane" value="MailPiston" className="overview-route-node--core" />
            <RouteNode icon="addresses" overline="Reply identities" value={`${sendCapable} send-capable`} className="overview-route-node--address" />
            <i className="overview-route-line overview-route-line--one" aria-hidden="true" />
            <i className="overview-route-line overview-route-line--two" aria-hidden="true" />
          </div>
        </Card>

        <Card className="overview-readiness p-5">
          <p className="overview-kicker">Operational readiness</p>
          <h2>Finish the route, then send.</h2>
          <ol>
            <ReadinessItem complete={domains.length > 0} label="Add a domain" href="/domains" />
            <ReadinessItem complete={verified > 0} label="Publish and verify DNS" href="/domains" />
            <ReadinessItem complete={sendCapable > 0} label="Create a sending identity" href="/addresses" />
          </ol>
          <Link href="/mail" className="overview-mail-link">Open the mail workspace <span aria-hidden="true">→</span></Link>
        </Card>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  href,
  icon,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  icon: 'domains' | 'verified' | 'addresses' | 'sent';
  tone: 'blue' | 'green' | 'pink' | 'orange';
}) {
  return (
    <Link
      href={href}
      className={`overview-stat overview-stat--${tone} flex flex-col gap-2 rounded-lg bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:ring-ring/40`}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span className="font-serif text-3xl tracking-tight">{value}</span>
    </Link>
  );
}

function RouteNode({ icon, overline, value, className }: { icon: 'domains' | 'overview' | 'addresses'; overline: string; value: string; className: string }) {
  return (
    <div className={`overview-route-node ${className}`}>
      <span><Icon name={icon} size={16} /></span>
      <div><small>{overline}</small><strong>{value}</strong></div>
    </div>
  );
}

function ReadinessItem({ complete, label, href }: { complete: boolean; label: string; href: string }) {
  return (
    <li>
      <span className={complete ? 'is-complete' : ''}><Icon name={complete ? 'verified' : 'pending'} size={14} /></span>
      <Link href={href}>{label}</Link>
      <small>{complete ? 'Complete' : 'Required'}</small>
    </li>
  );
}
