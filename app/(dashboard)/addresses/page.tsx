import { Icon } from '@/components/icon';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import {
  AddAddressForm,
  DeleteAddressButton,
} from '@/components/mail/address-actions';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Addresses · MailPiston' };

export default async function AddressesPage() {
  const [addresses, domains] = await Promise.all([
    repositories.addresses.list(),
    repositories.domains.list(),
  ]);

  const domainOptions = domains.map((domain) => ({
    id: domain.id,
    name: domain.name,
    hasCatchAll: Boolean(domain.catchAllAliasId),
  }));

  return (
    <>
      <PageHeader
        title="Addresses"
        description="Send-capable addresses get a concrete provider alias. Inbound-only addresses stay local, behind the domain catch-all."
        actions={<AddAddressForm domains={domainOptions} />}
      />

      {domains.length === 0 ? (
        <EmptyState
          icon="addresses"
          title="Add a domain first"
          description="An address needs a domain to live on. Add one on the Domains page, publish its records, and come back."
        />
      ) : addresses.length === 0 ? (
        <EmptyState
          icon="addresses"
          title="No addresses yet"
          description="Create support@ on your test domain with sending enabled — that is the address the end-to-end prototype loop runs through."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 font-medium">Address</th>
                <th className="px-4 py-2.5 font-medium">Routing</th>
                <th className="px-4 py-2.5 font-medium">Enabled</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {addresses.map((address) => (
                <tr key={address.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs">{address.email}</td>
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
                  <td className="px-4 py-2.5 text-right">
                    <DeleteAddressButton addressId={address.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
