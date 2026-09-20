import { Icon } from '@/components/icon';
import { EmptyState, PageHeader } from '@/components/layout/page-shell';
import {
  AddDomainForm,
  CopyButton,
  DriftBanner,
  VerificationIssues,
  VerifyDomainButton,
  WebhookKeyForm,
} from '@/components/mail/domain-actions';
import type { Domain, DomainDnsRecord } from '@/server/core/types';
import { listDomainsWithWebhookKeys } from '@/server/mail/domains/webhook-keys';
import { repositories } from '@/server/repositories';

export const metadata = { title: 'Domains · MailPiston' };

/**
 * `fallback` — no key stored; inbound is verified against the env variable.
 * `stored` — a key is stored and readable.
 * `unreadable` — a key is stored and will not decrypt, so the resolver skips
 * it and every inbound delivery for this domain fails verification. That is
 * what an encryption-key rotation leaves behind if the re-encryption pass is
 * skipped, and it is otherwise completely silent.
 */
type WebhookKeyState = 'fallback' | 'stored' | 'unreadable';

const KEY_LABEL: Record<WebhookKeyState, string> = {
  fallback: 'using env fallback',
  stored: 'stored',
  unreadable: 'unreadable',
};

const KEY_TONE: Record<WebhookKeyState, string> = {
  fallback: 'border-border text-muted-foreground',
  stored: 'border-success/40 text-success',
  unreadable: 'border-destructive/40 text-destructive',
};

export default async function DomainsPage() {
  const [domains, withKeys, latestRun] = await Promise.all([
    repositories.domains.list(),
    listDomainsWithWebhookKeys(),
    repositories.reconciliation.latestRun(),
  ]);

  // Three states, not two. A key that is stored but no longer decrypts is the
  // silent failure an encryption-key rotation leaves behind, and this is the
  // screen where it has to be visible.
  const keyState = new Map(
    withKeys.map((row) => [row.domainId, row.readable ? 'stored' : 'unreadable'] as const),
  );

  // Findings only. An `ok` item means the sweep looked and was satisfied, which
  // belongs in the run summary rather than in a banner about problems.
  const items = latestRun
    ? await repositories.reconciliation.listItems(latestRun.id)
    : [];

  const findings = items
    .filter((item) => item.status !== 'ok')
    .map((item) => ({
      resourceId: item.resourceId,
      resourceType: item.resourceType,
      status: item.status,
      detail: item.detail,
    }));

  const domainNames = Object.fromEntries(
    domains.map((domain) => [domain.id, domain.name]),
  );

  return (
    <>
      <PageHeader
        title="Domains"
        description="Add or import a domain, publish the records it shows you, then verify. Existing Forward Email domains are imported automatically."
        actions={<AddDomainForm />}
      />

      {/* Detected, never repaired on its own. The button below is the only
          thing that changes provider configuration from a finding. */}
      <DriftBanner
        findings={findings}
        checkedAt={
          latestRun?.finishedAt
            ? latestRun.finishedAt.toISOString().replace('T', ' ').slice(0, 19)
            : null
        }
        domainNames={domainNames}
      />

      {domains.length === 0 ? (
        <EmptyState
          icon="domains"
          title="No domains yet"
          description="Add a throwaway domain first. Do not point a domain you care about at MailPiston until the pipeline has run end to end."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {domains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              webhookKey={keyState.get(domain.id) ?? 'fallback'}
            />
          ))}
        </div>
      )}
    </>
  );
}

function DomainCard({
  domain,
  webhookKey,
}: {
  domain: Domain;
  webhookKey: WebhookKeyState;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-sm">{domain.name}</h2>
          <StatusBadge status={domain.status} />
          <VerificationIssues issues={domain.verificationErrors} />
          {domain.catchAllAliasId ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              catch-all
            </span>
          ) : null}
        </div>

        <VerifyDomainButton domainId={domain.id} />
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <span className="text-xs text-muted-foreground">
          Inbound webhook key
        </span>

        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${KEY_TONE[webhookKey]}`}
        >
          {KEY_LABEL[webhookKey]}
        </span>

        {webhookKey === 'unreadable' ? (
          <span className="text-xs text-destructive">
            Stored under a different encryption key, so it is being skipped —
            inbound mail for this domain is failing verification. Paste the key
            from Forward Email again to fix it.
          </span>
        ) : null}

        <WebhookKeyForm
          domainId={domain.id}
          configured={webhookKey !== 'fallback'}
        />
      </div>

      <div className="px-5 py-4">
        <DnsRecords records={domain.dnsRecords} />

        {domain.lastVerifiedAt ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Last checked {domain.lastVerifiedAt.toISOString()}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: Domain['status'] }) {
  const styles: Record<Domain['status'], string> = {
    verified: 'border-success/40 text-success',
    pending: 'border-warning/40 text-warning',
    // `failed` is not terminal: DNS propagates, so it only means "checked and
    // not passing yet" rather than "give up".
    failed: 'border-destructive/40 text-destructive',
    disabled: 'border-border text-muted-foreground',
  };

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${styles[status]}`}
    >
      {status}
    </span>
  );
}

/**
 * The DNS records, split by what they actually buy you.
 *
 * Receiving and sending fail differently and are fixed at different times.
 * MX and the verification TXT decide whether mail reaches MailPiston at all;
 * SPF, DKIM, the return path and DMARC decide whether mail *from* the domain is
 * accepted by the far end. A single undifferentiated table hides that — a
 * domain can be receiving perfectly while every message it sends lands in spam,
 * and both look like "some rows are green".
 *
 * Every value here is the provider's own, per-domain: the DKIM selector and
 * public key and the DMARC `rua` cannot be derived from a template, which is
 * the reason this table is worth showing at all rather than linking out to the
 * provider's console.
 */
function DnsRecords({ records }: { records: DomainDnsRecord[] }) {
  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No DNS records recorded yet. Run Verify to fetch them from the provider.
      </p>
    );
  }

  const receiving = records.filter((record) =>
    RECEIVING.has(record.purpose),
  );
  const sending = records.filter((record) => !RECEIVING.has(record.purpose));

  return (
    <div className="flex flex-col gap-5">
      <RecordGroup
        title="Receiving"
        caption="Until these are live, mail to this domain never reaches MailPiston."
        records={receiving}
      />
      <RecordGroup
        title="Sending"
        caption="Until these are live, mail sent from this domain is unauthenticated and will be filtered."
        records={sending}
      />
    </div>
  );
}

const RECEIVING = new Set<DomainDnsRecord['purpose']>(['inbound', 'verification']);

const PURPOSE_LABEL: Record<DomainDnsRecord['purpose'], string> = {
  inbound: 'Routes mail to Forward Email',
  verification: 'Proves you own the domain',
  spf: 'Authorises Forward Email to send as you',
  dkim: 'Signs your outgoing mail',
  'return-path': 'Where bounces come back to',
  dmarc: 'Tells receivers what to do with failures',
};

function RecordGroup({
  title,
  caption,
  records,
}: {
  title: string;
  caption: string;
  records: DomainDnsRecord[];
}) {
  if (records.length === 0) return null;

  const outstanding = records.filter((record) => !record.present).length;

  return (
    <section>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-xs font-medium">{title}</h3>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${
            outstanding === 0
              ? 'border-success/40 text-success'
              : 'border-warning/40 text-warning'
          }`}
        >
          {outstanding === 0
            ? 'all published'
            : `${outstanding} outstanding`}
        </span>
        {outstanding > 0 ? (
          <span className="text-[11px] text-muted-foreground">{caption}</span>
        ) : null}
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Value</th>
              <th className="pb-2 font-medium">Purpose</th>
              <th className="pb-2 font-medium">Present</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => (
              <tr
                key={`${record.type}-${record.name}-${index}`}
                className="border-t border-border"
              >
                <td className="py-2 font-mono align-top">
                  {record.type}
                  {record.priority ? ` (${record.priority})` : ''}
                </td>
                <td className="py-2 font-mono align-top">
                  <span className="flex items-center gap-1">
                    <span className="break-all">{record.name}</span>
                    <CopyButton value={record.name} />
                  </span>
                </td>
                <td className="py-2 align-top">
                  <span className="flex items-start gap-1">
                    {/* DKIM keys are ~400 characters and must be copied whole,
                        so the value wraps rather than truncating. */}
                    <code className="font-mono break-all">{record.value}</code>
                    <CopyButton value={record.value} />
                  </span>
                </td>
                <td className="py-2 align-top text-muted-foreground">
                  {PURPOSE_LABEL[record.purpose] ?? record.purpose}
                </td>
                <td className="py-2 align-top">
                  <Icon
                    name={record.present ? 'verified' : 'pending'}
                    size={14}
                    className={
                      record.present ? 'text-success' : 'text-muted-foreground'
                    }
                    aria-label={record.present ? 'Present' : 'Not found'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
