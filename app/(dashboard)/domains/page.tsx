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
import { DomainMenu } from '@/components/mail/domain-menu';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
    withKeys.map(
      (row) => [row.domainId, row.readable ? 'stored' : 'unreadable'] as const,
    ),
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
        toolbar={<AddDomainForm />}
      />

      {/* Detected, never repaired on its own. The buttons inside are the only
          things that change provider configuration from a finding. */}
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
        <div className="flex flex-col gap-5">
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

/**
 * One domain, as three bands: identity, ingress key, DNS.
 *
 * The bands are separated by rules and have real padding between them. The
 * previous version packed all three into 12px rows, which made a domain name,
 * its status, a key state and a table of six records read as one undifferentiated
 * block — and the domain name, which is the thing you are looking for when
 * scanning, had the same weight as everything else.
 */
function DomainCard({
  domain,
  webhookKey,
}: {
  domain: Domain;
  webhookKey: WebhookKeyState;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <CardTitle className="font-mono text-base tracking-tight">
            {domain.name}
          </CardTitle>
          <StatusBadge status={domain.status} />
          {domain.catchAllAliasId ? (
            <StatusBadge status="catch-all" tone="info" label="catch-all" />
          ) : null}
          <VerificationIssues issues={domain.verificationErrors} />
        </div>

        <div className="flex items-center gap-1.5">
          <VerifyDomainButton domainId={domain.id} />
          <DomainMenu
            domainId={domain.id}
            name={domain.name}
            hasCatchAll={Boolean(domain.catchAllAliasId)}
          />
        </div>
      </CardHeader>

      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b px-5 py-3.5">
        <span className="text-xs font-medium">Inbound webhook key</span>
        <StatusBadge status={webhookKey} label={KEY_LABEL[webhookKey]} />

        <WebhookKeyForm
          domainId={domain.id}
          configured={webhookKey !== 'fallback'}
        />

        {webhookKey === 'unreadable' ? (
          <p className="w-full text-xs leading-relaxed text-destructive">
            Stored under a different encryption key, so it is being skipped —
            inbound mail for this domain is failing verification. Paste the key
            from Forward Email again to fix it.
          </p>
        ) : null}
      </CardContent>

      <CardContent className="px-5 py-4">
        <DnsRecords records={domain.dnsRecords} />

        {domain.lastVerifiedAt ? (
          <>
            <Separator className="my-3.5" />
            <p className="text-xs text-muted-foreground">
              Last checked{' '}
              <time dateTime={domain.lastVerifiedAt.toISOString()}>
                {domain.lastVerifiedAt
                  .toISOString()
                  .replace('T', ' ')
                  .slice(0, 19)}{' '}
                UTC
              </time>
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
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

  const receiving = records.filter((record) => RECEIVING.has(record.purpose));
  const sending = records.filter((record) => !RECEIVING.has(record.purpose));

  return (
    <div className="flex flex-col gap-6">
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

const RECEIVING = new Set<DomainDnsRecord['purpose']>([
  'inbound',
  'verification',
]);

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
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h3 className="text-xs font-semibold tracking-wide uppercase">
          {title}
        </h3>
        <StatusBadge
          status={outstanding === 0 ? 'verified' : 'pending'}
          label={
            outstanding === 0 ? 'all published' : `${outstanding} outstanding`
          }
        />
        {outstanding > 0 ? (
          <span className="text-xs text-muted-foreground">{caption}</span>
        ) : null}
      </div>

      <Table className="mt-3">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 w-16 ps-0">Type</TableHead>
            <TableHead className="h-8 w-[22%]">Name</TableHead>
            <TableHead className="h-8">Value</TableHead>
            <TableHead className="h-8 w-[26%]">Purpose</TableHead>
            <TableHead className="h-8 w-16 text-right">Live</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record, index) => (
            <TableRow key={`${record.type}-${record.name}-${index}`}>
              {/* `py-3` and `align-top` together: a DKIM value wraps to three
                  lines, and a vertically centred type column next to it floats
                  in the middle of nowhere. */}
              <TableCell className="py-3 ps-0 align-top font-mono text-muted-foreground">
                {record.type}
                {record.priority ? (
                  <span className="text-muted-foreground/60">
                    {' '}
                    {record.priority}
                  </span>
                ) : null}
              </TableCell>

              <TableCell className="py-3 align-top">
                <span className="flex items-start gap-1">
                  <code className="font-mono break-all">{record.name}</code>
                  <CopyButton value={record.name} />
                </span>
              </TableCell>

              <TableCell className="py-3 align-top">
                <span className="flex items-start gap-1">
                  {/* DKIM keys are ~400 characters and must be copied whole,
                      so the value wraps rather than truncating. */}
                  <code className="font-mono leading-relaxed break-all">
                    {record.value}
                  </code>
                  <CopyButton value={record.value} />
                </span>
              </TableCell>

              <TableCell className="py-3 align-top text-muted-foreground">
                {PURPOSE_LABEL[record.purpose] ?? record.purpose}
              </TableCell>

              <TableCell className="py-3 text-right align-top">
                <Icon
                  name={record.present ? 'verified' : 'pending'}
                  size={14}
                  className={
                    record.present
                      ? 'inline text-success'
                      : 'inline text-muted-foreground/50'
                  }
                  aria-label={record.present ? 'Present' : 'Not found'}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
