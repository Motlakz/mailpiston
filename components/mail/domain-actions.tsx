'use client';

import { Popover } from '@base-ui/react/popover';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

export interface DriftFinding {
  resourceId: string;
  resourceType: string;
  status: string;
  detail: Record<string, unknown>;
}

/** What a person can actually do about one finding, or nothing. */
type Repair = { label: string; path: string } | null;

/**
 * Reasons whose fix is repointing the alias at our ingress.
 *
 * `provider_domain_id_changed` is deliberately not here: the domain was
 * recreated at the provider, so every alias id we hold belongs to the old one
 * and the domain has to be re-verified before an alias repair means anything.
 */
const REPOINTABLE = new Set([
  'recipient_not_our_ingress',
  'additional_recipients',
  'disabled_at_provider',
  'local_part_changed',
  'not_found_at_provider',
]);

function repairFor(finding: DriftFinding, known: boolean): Repair {
  if (!known) return null;

  const reason = String(finding.detail.reason ?? '');
  if (!REPOINTABLE.has(reason)) return null;

  return finding.resourceType === 'alias' && finding.detail.localPart !== '*'
    ? {
        label: 'Repoint alias',
        path: `/api/v1/addresses/${finding.resourceId}/repair`,
      }
    : {
        label: 'Repair catch-all',
        path: `/api/v1/domains/${finding.resourceId}/catch-all`,
      };
}

/**
 * The drift banner (roadmap Phase 10).
 *
 * Reconciliation detects and stops. This is where a person sees what it found
 * and decides — every repair here is a button, and they are the only things in
 * the system that change provider configuration on the strength of a finding.
 *
 * Three things this screen has to do that a list of reason codes does not.
 *
 * **Show the values.** `recipient_not_our_ingress` names the rule that broke,
 * not the fact that broke it. The fact is almost always an origin that moved —
 * aliases carry the absolute ingress URL that was current when they were made —
 * and that is invisible without the two URLs side by side.
 *
 * **Offer the repair for every repairable finding, not just the catch-all.** A
 * banner that reports a problem and offers nothing to do about it is why
 * "Check again" reads as broken: it re-runs honestly, finds the same drift, and
 * the screen has no way to look any different.
 *
 * **Say what the re-check found.** Same reason. An action whose success and
 * failure render identically cannot tell you it worked.
 */
export function DriftBanner({
  findings,
  checkedAt,
  domainNames,
}: {
  findings: DriftFinding[];
  checkedAt: string | null;
  /** Domain id → name, so a finding reads as a place rather than an id. */
  domainNames: Record<string, string>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function recheck(): Promise<number> {
    const summary = await apiRequest<{
      checked: number;
      drift: number;
      missing: number;
      errors: number;
    }>('/api/v1/reconciliation', { method: 'POST' });

    startTransition(() => router.refresh());

    const outstanding = summary.drift + summary.missing + summary.errors;

    setNote(
      outstanding === 0
        ? `Checked ${summary.checked} — everything matches.`
        : `Checked ${summary.checked} — ${outstanding} still not matching.`,
    );

    return outstanding;
  }

  async function runRecheck() {
    setError(null);
    setNote(null);
    setBusy('recheck');

    try {
      await recheck();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(null);
    }
  }

  /** One repair, then a sweep so the banner reflects the new truth. */
  async function repair(target: Repair, key: string) {
    if (!target) return;

    setError(null);
    setNote(null);
    setBusy(key);

    try {
      await apiRequest(target.path, { method: 'PUT' });
      await recheck();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Every repairable finding, then one sweep at the end.
   *
   * Sequential on purpose: these are writes to provider configuration, and a
   * parallel burst against one domain's alias collection is the wrong thing to
   * do to an API we do not control. A failure stops the run rather than
   * continuing — if repointing one alias failed, the next is likely to fail the
   * same way, and a half-finished repair should be visible as such.
   */
  async function repairAll() {
    setError(null);
    setNote(null);
    setBusy('all');

    try {
      let repaired = 0;

      for (const finding of findings) {
        const target = repairFor(finding, isKnown(finding, domainNames));
        if (!target) continue;

        await apiRequest(target.path, { method: 'PUT' });
        repaired += 1;
      }

      const outstanding = await recheck();

      setNote(
        `Repaired ${repaired}. ${
          outstanding === 0
            ? 'Everything matches now.'
            : `${outstanding} still not matching.`
        }`,
      );
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(null);
    }
  }

  const repairable = findings.filter((finding) =>
    repairFor(finding, isKnown(finding, domainNames)),
  ).length;

  if (findings.length === 0) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        {checkedAt
          ? `Provider configuration matched at ${checkedAt} UTC.`
          : 'Provider configuration has not been checked yet.'}{' '}
        <button
          type="button"
          onClick={runRecheck}
          disabled={busy !== null}
          className="underline hover:text-foreground disabled:no-underline disabled:opacity-60"
        >
          {busy === 'recheck' ? 'Checking…' : 'Check now'}
        </button>
        {note ? <span className="ml-2">{note}</span> : null}
        {error ? <span className="ml-2 text-destructive">{error}</span> : null}
      </p>
    );
  }

  return (
    <Card className="mt-5 gap-0 py-0 ring-warning/40">
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3.5">
        <h2 className="text-sm font-medium text-warning">
          Provider configuration has drifted
        </h2>
        <span className="text-xs text-muted-foreground">
          {checkedAt ? `checked ${checkedAt} UTC` : null}
        </span>
      </CardHeader>

      <CardContent className="px-5 py-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Nothing has been changed. Mail for anything listed here may not be
        reaching MailPiston at all.
      </p>

      <ul className="mt-3.5 flex flex-col gap-3">
        {findings.map((finding) => {
          const key = `${finding.resourceType}-${finding.resourceId}-${String(finding.detail.reason)}`;
          const target = repairFor(finding, isKnown(finding, domainNames));

          return (
            <li
              key={key}
              className="border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <StatusBadge status={finding.status} />
                <span className="font-mono">
                  {labelFor(finding, domainNames)}
                </span>
                <span className="text-muted-foreground">
                  {REASON_TEXT[String(finding.detail.reason)] ??
                    String(finding.detail.reason ?? 'unknown')}
                </span>

                {target ? (
                  <button
                    type="button"
                    onClick={() => repair(target, key)}
                    disabled={busy !== null}
                    className="underline hover:text-foreground disabled:no-underline disabled:opacity-60"
                  >
                    {busy === key ? 'Repairing…' : target.label}
                  </button>
                ) : null}
              </div>

              <ValueComparison detail={finding.detail} />
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runRecheck}
          disabled={busy !== null}
          className="text-xs text-muted-foreground underline hover:text-foreground disabled:no-underline disabled:opacity-60"
        >
          {busy === 'recheck' ? 'Checking…' : 'Check again'}
        </button>

        {repairable > 1 ? (
          <button
            type="button"
            onClick={repairAll}
            disabled={busy !== null}
            className="text-xs text-muted-foreground underline hover:text-foreground disabled:no-underline disabled:opacity-60"
          >
            {busy === 'all' ? 'Repairing…' : `Repair all ${repairable}`}
          </button>
        ) : null}

        {note ? (
          <span className="text-xs text-muted-foreground">{note}</span>
        ) : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
      </CardContent>
    </Card>
  );
}

/**
 * The two values, when the finding carries them.
 *
 * This is the part that turns a reason code into a diagnosis. `expected` and
 * `actual` are usually two ingress URLs differing only by host, which is
 * unreadable as prose and obvious as two stacked monospace lines.
 */
function ValueComparison({ detail }: { detail: Record<string, unknown> }) {
  const expected = detail.expected;
  const actual = detail.actual;

  if (expected === undefined && actual === undefined) return null;

  return (
    <dl className="mt-1.5 ml-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
      {expected !== undefined ? (
        <>
          <dt className="text-muted-foreground">expected</dt>
          <dd className="font-mono break-all text-success">
            {asText(expected)}
          </dd>
        </>
      ) : null}
      {actual !== undefined ? (
        <>
          <dt className="text-muted-foreground">actual</dt>
          <dd className="font-mono break-all text-destructive">
            {asText(actual)}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

function asText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? '(none)' : value.join(', ');
  }
  return String(value);
}

/**
 * Whether we can act on this finding at all.
 *
 * A catch-all finding whose domain is no longer in `domainNames` came from a
 * run against state that has since been deleted, and offering a repair for it
 * would call a route that 404s.
 */
function isKnown(
  finding: DriftFinding,
  domainNames: Record<string, string>,
): boolean {
  if (finding.resourceType === 'alias' && finding.detail.localPart !== '*') {
    // An alias finding's `resourceId` is the address, which this map does not
    // carry. The address existed when the sweep ran; the repair route answers
    // for it if it still does.
    return true;
  }

  return Boolean(domainNames[finding.resourceId]);
}

function labelFor(
  finding: DriftFinding,
  domainNames: Record<string, string>,
): string {
  if (finding.resourceType === 'alias') {
    return `${String(finding.detail.localPart ?? '?')}@${String(finding.detail.domain ?? '')}`;
  }

  return (
    domainNames[finding.resourceId] ??
    String(finding.detail.name ?? finding.resourceId)
  );
}

/**
 * The reason codes as a sentence.
 *
 * The codes are the right thing to store — stable and greppable — and the wrong
 * thing to read at a glance when mail may be going missing.
 */
const REASON_TEXT: Record<string, string> = {
  recipient_not_our_ingress: 'forwarding somewhere that is not this deployment',
  additional_recipients: 'also forwarding somewhere we do not know about',
  disabled_at_provider: 'disabled at the provider, so it receives nothing',
  local_part_changed: 'renamed at the provider',
  not_found_at_provider: 'gone from the provider',
  no_provider_domain_id: 'never linked to a provider domain',
  provider_domain_id_changed:
    'recreated at the provider, so every alias id we hold is stale — verify the domain first',
  no_longer_verified_at_provider:
    'no longer passing verification at the provider',
};

export function AddDomainForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [createCatchAll, setCreateCatchAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest('/api/v1/domains', {
        method: 'POST',
        body: JSON.stringify({ name, createCatchAll }),
      });

      setName('');
      setCreateCatchAll(false);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <form onSubmit={submit} className="dashboard-inline-form flex flex-wrap items-center gap-2">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="example.com"
        aria-label="Domain name"
        required
        className="w-44"
      />

      <Label className="gap-1.5 text-xs font-normal text-muted-foreground">
        <Checkbox
          checked={createCatchAll}
          onCheckedChange={(checked) => setCreateCatchAll(checked === true)}
        />
        {/* Off by default: a catch-all means receiving mail for local parts
            that do not exist, which the inbound pipeline must then drop. */}
        Catch-all
      </Label>

      <Button type="submit" disabled={pending}>
        <Icon name="add" size={13} />
        Add or import
      </Button>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

export function VerifyDomainButton({ domainId }: { domainId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setError(null);

    try {
      await apiRequest(`/api/v1/domains/${domainId}/verify`, { method: 'POST' });
      router.refresh();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={verify} disabled={busy}>
        <Icon name="refresh" size={12} />
        {busy ? 'Checking…' : 'Verify'}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

/**
 * The provider's reasons a check did not pass, behind a disclosure.
 *
 * They arrive as prose — "Domain is missing required DNS MX records of: …" —
 * and there can be several, so they belong in a panel the operator opens next
 * to the status rather than as inline text beside the button.
 */
export function VerificationIssues({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 rounded-full border border-warning/40 px-2 py-0.5 text-[11px] text-warning outline-none hover:bg-warning/10 focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        }
      >
        <Icon name="failed" size={11} />
        {issues.length} DNS {issues.length === 1 ? 'issue' : 'issues'}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start">
          <Popover.Popup className="z-50 max-h-80 w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-popover p-3 text-xs shadow-lg outline-none">
            <Popover.Title className="mb-2 font-medium">
              Waiting on DNS
            </Popover.Title>
            <ul className="flex flex-col gap-2">
              {issues.map((issue, index) => (
                <li
                  key={index}
                  className="border-t border-border pt-2 text-muted-foreground whitespace-pre-wrap first:border-t-0 first:pt-0"
                >
                  {issue}
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Copy value"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <Icon name={copied ? 'verified' : 'copy'} size={12} />
    </Button>
  );
}

function messageFor(error: unknown): string {
  return error instanceof ApiRequestError
    ? error.message
    : 'Something went wrong. Check the server logs.';
}

/**
 * Stores the per-domain inbound webhook key.
 *
 * Write-only by design. Forward Email issues one webhook key per domain, and
 * the plaintext is needed only on the server to recompute an HMAC — so there is
 * no route that reads it back and nothing here ever displays it. The only
 * thing the operator needs to see is whether one is stored.
 */
export function WebhookKeyForm({
  domainId,
  configured,
}: {
  domainId: string;
  configured: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest(`/api/v1/domains/${domainId}/webhook-key`, {
        method: 'PUT',
        body: JSON.stringify({ webhookKey: value }),
      });

      setValue('');
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  async function clear() {
    setError(null);

    try {
      await apiRequest(`/api/v1/domains/${domainId}/webhook-key`, {
        method: 'DELETE',
      });
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    }
  }

  return (
    <form onSubmit={save} className="dashboard-inline-form flex flex-wrap items-center gap-2">
      <Input
        type="password"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={configured ? 'Replace stored key' : 'Paste webhook key'}
        aria-label="Inbound webhook key"
        autoComplete="off"
        required
        className="w-56 font-mono"
      />

      <Button type="submit" disabled={pending}>
        {configured ? 'Replace' : 'Save'}
      </Button>

      {configured ? (
        <button
          type="button"
          onClick={clear}
          disabled={pending}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Remove
        </button>
      ) : null}

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </form>
  );
}
