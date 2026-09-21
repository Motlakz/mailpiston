import { Icon } from '@/components/icon';
import { NavTabs } from '@/components/layout/nav-tabs';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import {
  AddAddressForm,
  RepairAliasButton,
} from '@/components/mail/address-actions';
import { AddressMenu } from '@/components/mail/address-menu';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
        toolbar={
          // Filter and create share one row. They were two floating boxes —
          // the domain tabs below the heading and the domain Select up in the
          // action slot — which read as unrelated controls despite both being
          // about which domain you are working in.
          <div className="dashboard-toolbar-stack">
            <AddAddressForm
              domains={domainOptions}
              // Adding an address while looking at one app should default to
              // that app. Getting this wrong creates support@ on the wrong
              // domain, which is a provider alias and a DNS-shaped mistake.
              defaultDomainId={active ?? undefined}
            />

            {
          // One domain is not a choice, so the tabs would be decoration.
          domains.length > 1 ? (
            <NavTabs
              aria-label="Filter by domain"
              active={active ?? 'all'}
              tabs={[
                {
                  key: 'all',
                  label: 'All',
                  href: '/addresses',
                  count: addresses.length,
                },
                ...domains.map((domain) => ({
                  key: domain.id,
                  label: domain.name,
                  href: `/addresses?domain=${domain.id}`,
                  count: countFor(domain.id),
                })),
              ]}
            />
          ) : null}
          </div>
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
          {active ? (
            <DomainNote domain={domains.find((d) => d.id === active)!} />
          ) : null}

          <div>
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

/**
 * The one thing about a domain that changes what its addresses can be.
 *
 * Without a catch-all, an inbound-only address on this domain would never
 * receive anything — and that is refused at creation, so saying it here turns a
 * confusing error into an expected one.
 */
function DomainNote({ domain }: { domain: Domain }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
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
    <Card className="gap-0 overflow-hidden py-0">
      <Table className="min-w-160">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 px-4">
              {showDomain ? 'Address' : 'Local part'}
            </TableHead>
            <TableHead className="h-10 px-4">Routing</TableHead>
            <TableHead className="h-10 px-4">State</TableHead>
            <TableHead className="h-10 px-4">Created</TableHead>
            <TableHead className="h-10 px-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {addresses.map((address) => (
            <TableRow key={address.id}>
              {/* The address is the identifier, so it carries the weight; every
                  other column in the row is an attribute of it. */}
              <TableCell className="px-4 py-3.5 font-mono text-sm font-medium">
                {showDomain ? address.email : address.localPart}
              </TableCell>
              <TableCell className="px-4 py-3.5">
                {address.providerAliasId ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Icon name="sent" size={13} className="text-success" />
                    Concrete alias · can send
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Icon name="inbox" size={13} />
                    Local route · inbound only
                  </span>
                )}
              </TableCell>
              <TableCell className="px-4 py-3.5">
                <StatusBadge
                  status={address.enabled ? 'verified' : 'disabled'}
                  label={address.enabled ? 'enabled' : 'disabled'}
                />
              </TableCell>
              <TableCell className="px-4 py-3.5 text-muted-foreground tabular-nums">
                {address.createdAt.toISOString().slice(0, 10)}
              </TableCell>
              <TableCell className="px-4 py-3.5">
                <span className="flex items-center justify-end gap-1">
                  {/* Repointing an alias at the current ingress is useful here
                      and not only from a drift finding: the reconciliation
                      sweep runs every six hours, and somebody who has just
                      changed APP_URL should not have to wait for it. */}
                  {address.providerAliasId ? (
                    <RepairAliasButton addressId={address.id} />
                  ) : null}
                  <AddressMenu
                    addressId={address.id}
                    email={address.email}
                    enabled={address.enabled}
                    canSend={address.canSend}
                  />
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
