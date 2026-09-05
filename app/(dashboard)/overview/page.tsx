import Link from 'next/link';

import { Icon } from '@/components/icon';
import { PageHeader } from '@/components/layout/page-shell';
import { repositories } from '@/server/repositories';

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Domains" value={domains.length} href="/domains" icon="domains" />
        <Stat label="Verified" value={verified} href="/domains" icon="verified" />
        <Stat
          label="Addresses"
          value={addresses.length}
          href="/addresses"
          icon="addresses"
        />
        <Stat
          label="Send-capable"
          value={sendCapable}
          href="/addresses"
          icon="sent"
        />
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-medium">Next steps</h2>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Add a domain and publish the DNS records it shows you.</li>
          <li>2. Verify the domain once the records have propagated.</li>
          <li>
            3. Create a send-capable address — that is what authorises a{' '}
            <code className="font-mono text-xs">From:</code> at the provider.
          </li>
        </ol>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  href,
  icon,
}: {
  label: string;
  value: number;
  href: string;
  icon: 'domains' | 'verified' | 'addresses' | 'sent';
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:border-ring/40"
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span className="font-serif text-3xl tracking-tight">{value}</span>
    </Link>
  );
}
