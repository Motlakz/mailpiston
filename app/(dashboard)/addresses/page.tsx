import Link from 'next/link';

import { Icon } from '@/components/icon';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import {
  AddAddressForm,
  DeleteAddressButton,
  RepairAliasButton,
} from '@/components/mail/address-actions';
import type { AddressWithDomain, Domain } from '@/server/core/types';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Addresses · MailPiston' };

/**
 * Addresses, grouped by the domain they live on.
 *
 * A flat table was fine with three addresses and stops being fine at fifteen,
 * because the domains are not a taxonomy here — they are separate products.
 * `support@bellyclock.com` and `support@pillbird.com` are the same string doing
 * two unrelated jobs, and a single list forces the reader to disambiguate them
 * on every glance.
 *
 * The tab is a URL parameter rather than component state so a particular app's
 * addresses are a link somebody can keep.
 */
export default async function AddressesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.domain) ? params.domain[0] : params.domain;

  const [addresses, domains] = await Promise.all([
    repositories.addresses.list(),
    repositories.domains.list(),
  ]);

  const domainOptions = domains.map((domain) => ({
    id: domain.id,
    name: domain.name,
    hasCatchAll: Boolean(domain.catchAllAliasId),
  }));

  // An unknown or absent parameter falls back to everything rather than to an
  // empty screen: a stale bookmark should degrade, not break.
  const active = raw && domains.some((domain) => domain.id === raw) ? raw : null;

  const visible = active
    ? addresses.filter((address) => address.domainId === active)
    : addresses;

  const countFor = (domainId: string) =>
    addresses.filter((address) => address.domainId === domainId).length;

  return (
    <>
      <PageHeader
        title="Addresses"
        description="Send-capable addresses get a concrete provider alias. Inbound-only addresses stay local, behind the domain catch-all."
        actions={
          <AddAddressForm
            domains={domainOptions}
            // Adding an address while looking at one app should default to that
            // app. Getting this wrong creates support@ on the wrong domain,
            // which is a provider alias and a DNS-shaped mistake to undo.
            defaultDomainId={active ?? undefined}
          />
        }
      />

      {domains.length === 0 ? (
        <EmptyState
          icon="addresses"
          title="Add a domain first"
          description="An address needs a domain to live on. Add one on the Domains page, publish its records, and come back."
        />
      ) : (
        <>
          {domains.length > 1 ? (
            <nav className="mt-4 flex flex-wrap items-center gap-1.5">
              <Tab href="/addresses" label="All" count={addresses.length} active={active === null} />
              {domains.map((domain) => (
                <Tab
                  key={domain.id}
                  href={`/addresses?domain=${domain.id}`}
                  label={domain.name}
                  count={countFor(domain.id)}
                  active={active === domain.id}
                />
              ))}
            </nav>
          ) : null}

          {active ? <DomainNote domain={domains.find((d) => d.id === active)!} /> : null}

          <div className="mt-4">
            {visible.length === 0 ? (
              <EmptyState
                icon="addresses"
                title="No addresses here yet"
                description="Create support@ on this domain with sending enabled — that is the address the end-to-end loop runs through."
              />
            ) : (
              <AddressTable addresses={visible} showDomain={active === null} />
            )}
          </div>
        </>
      )}
    </>
  );
}

function Tab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-foreground/20 bg-foreground text-background'
          : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground'
      }`}
    >
      <span className={label === 'All' ? '' : 'font-mono'}>{label}</span>
      <span className={active ? 'opacity-60' : 'opacity-70'}>{count}</span>
    </Link>
  );
}

/**
 * The one thing about a domain that changes what its addresses can be.
 *
 * Without a catch-all, an inbound-only address on this domain would never
 * receive anything — and that is refused at creation, so saying it here turns a
 * confusing error into an expected one.
 */
function DomainNote({ domain }: { domain: Domain }) {
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      {domain.status === 'verified' ? null : (
        <span className="text-warning">
          {domain.name} is not verified yet, so mail to it may not arrive.{' '}
        </span>
      )}
      {domain.catchAllAliasId
        ? 'Has a catch-all, so inbound-only addresses work here.'
        : 'No catch-all, so every address here needs sending enabled to receive anything.'}
    </p>
  );
}

function AddressTable({
  addresses,
  showDomain,
}: {
  addresses: AddressWithDomain[];
  showDomain: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-4 py-2.5 font-medium">
              {showDomain ? 'Address' : 'Local part'}
            </th>
            <th className="px-4 py-2.5 font-medium">Routing</th>
            <th className="px-4 py-2.5 font-medium">Enabled</th>
            <th className="px-4 py-2.5 font-medium">Created</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {addresses.map((address) => (
            <tr key={address.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2.5 font-mono text-xs">
                {showDomain ? address.email : address.localPart}
              </td>
              <td className="px-4 py-2.5">
                {address.providerAliasId ? (
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <Icon name="sent" size={13} className="text-success" />
                    Concrete alias · can send
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon name="inbox" size={13} />
                    Local route · inbound only
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-xs">
                {address.enabled ? 'Yes' : 'No'}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                {address.createdAt.toISOString().slice(0, 10)}
              </td>
              <td className="px-4 py-2.5">
                <span className="flex items-center justify-end gap-1">
                  {/* Repointing an alias at the current ingress is useful here
                      and not only from a drift finding: the reconciliation
                      sweep runs every six hours, and somebody who has just
                      changed APP_URL should not have to wait for it. */}
                  {address.providerAliasId ? (
                    <RepairAliasButton addressId={address.id} />
                  ) : null}
                  <DeleteAddressButton addressId={address.id} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
