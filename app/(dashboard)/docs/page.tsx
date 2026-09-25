import Link from 'next/link';

import { Icon, type IconName } from '@/components/icon';
import { PageHeader } from '@/components/layout/page-shell';
import { CopySnippet } from '@/components/mail/copy-snippet';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { env } from '@/server/core/config';

export const metadata = { title: 'Docs · MailPiston' };

/**
 * The reference, inside the product.
 *
 * Deliberately not a link out to a docs site. Every question this page answers
 * is asked *while looking at a screen in the dashboard* — "what is an endpoint",
 * "why is this in spam", "what does repair actually do" — and an answer that
 * costs a context switch is an answer most people do not go and get.
 *
 * It reads live configuration rather than describing a default. The ingress URL
 * and replay window shown here are this deployment's actual values, so an
 * operator copying from this page cannot copy something that is true of some
 * other install.
 */
export default function DocsPage() {
  const ingress = new URL(
    '/api/providers/forward-email/inbound',
    env.APP_URL,
  ).toString();

  return (
    <>
      <PageHeader
        eyebrow="Reference"
        title="How MailPiston works"
        description="The concepts behind the screens, and the parts that are easy to get wrong. Everything here reflects this deployment's live configuration."
      />

      <div className="docs-layout">
        <article className="docs-article">
        <nav className="docs-index" aria-label="Documentation index">
          {DOC_GROUPS.map((section) => (
            <div key={section.group} className="docs-index__group">
              <p className="docs-index__label">{section.group}</p>
              <div className="docs-index__cards">
                {section.entries.map((entry) => (
                  <a key={entry.id} href={`#${entry.id}`} className="docs-index__card">
                    <strong>{entry.label}</strong>
                    <span>{entry.blurb}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <Section
          id="pipeline"
          icon="inbox"
          title="What happens to an inbound message"
          summary="Eight steps, with explicit stops for invalid, unroutable, looped, and quarantined mail."
        >
          <ol className="flex flex-col gap-2.5">
            {PIPELINE.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="endpoints"
          icon="endpoints"
          title="Endpoints"
          summary="Where a captured message goes next. Without one, mail is stored and nothing else happens."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DefinitionCard
              title="Webhook"
              badge="signed"
              body="An HTTPS URL. MailPiston POSTs a signed JSON payload; your application verifies it and does its own work. This is how an app receives its support mail."
              detail="Signed as HMAC-SHA256 over timestamp + '.' + body, so a captured delivery cannot be replayed later. Verify with verifyWebhook from @mailpiston/sdk rather than comparing a shared token."
            />
            <DefinitionCard
              title="Email"
              badge="verified"
              body="A personal inbox. Select a verified reply domain on the Domains page and MailPiston sends a notification whose Reply-To returns through the managed address."
              detail="The destination must prove control first. Forwarding stays paused without a reply relay, and managed-domain destinations are refused to prevent loops."
            />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Endpoints bind to <strong className="text-foreground">addresses</strong>,
            many-to-many — so one address can wake your application and your
            phone at once, and one endpoint can serve every address you own.
            Failed deliveries retry on a schedule; the log is on each endpoint.
            Quarantined mail never reaches any of them, which is the part of the
            spam filter you actually feel.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Personal-inbox forwarding runs only when a verified domain is
            selected for replies on the Domains page. A destination on one of this workspace&apos;s managed
            domains is refused because it would feed MailPiston&apos;s own output
            back into ingress.
          </p>
        </Section>

        <Section
          id="addresses"
          icon="addresses"
          title="Addresses come in two kinds"
          summary="The difference decides whether you can send, and it is not cosmetic."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DefinitionCard
              title="Concrete alias"
              badge="can send"
              body="Has its own alias at the provider pointing at this deployment. Required for sending: the provider will not authorise a From: header for an address that exists only behind a catch-all."
              detail="This is what the SDK's addressId refers to."
            />
            <DefinitionCard
              title="Local route"
              badge="inbound only"
              body="No provider alias of its own — it arrives because the domain's catch-all sends everything here, and MailPiston resolves the local part itself."
              detail="Only works on a domain that has a catch-all. Creating one without is refused rather than silently made, because it would never receive anything."
            />
          </div>
        </Section>

        <Section
          id="drift"
          icon="domains"
          title="Drift, and what repair does"
          summary="Your provider's configuration is the one that actually routes mail. This checks the two copies still agree."
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Every alias MailPiston creates carries this deployment&apos;s absolute
            ingress URL as its recipient:
          </p>
          <code className="mt-2 block overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[11px]">
            {ingress}
          </code>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Which means changing <code className="font-mono">APP_URL</code> is a
            migration, not a redeploy: every alias made before the change still
            points at the old origin. Nothing errors — the old origin usually
            still resolves — right up until it does not. A sweep runs every six
            hours and <strong className="text-foreground">only reports</strong>;
            repair is a button, because an automatic fix racing someone
            mid-change turns a visible problem into two writers disagreeing.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Repoint alias</strong> rewrites
            the alias&apos;s recipient to the URL above, finding it by local part
            rather than by stored id — the stored id is exactly what goes stale
            when a domain is recreated at the provider.
          </p>
        </Section>

        <Section
          id="filtering"
          icon="spam"
          title="Spam filtering"
          summary="Quarantine stops the fan-out. It never deletes."
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            A deterministic rule engine scores every inbound message across seven
            families: authentication failures, phishing language and link tricks,
            executable attachments, bulk-send headers, gibberish, cold-outreach
            templates, and empty deliveries.
          </p>

          <div className="mt-3 flex flex-col gap-2">
            {VERDICTS.map((verdict) => (
              <div
                key={verdict.name}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-md border border-border px-3 py-2"
              >
                <Badge variant={verdict.variant}>{verdict.name}</Badge>
                <span className="text-xs text-muted-foreground">
                  {verdict.body}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            A message that is a reply to something you already hold is heavily
            discounted — but not exempt, because a compromised account replying
            in-thread is how a convincing attack arrives. Every verdict stores
            the rules that produced it, visible on the message. Your{' '}
            <Link
              href="/settings"
              className="text-foreground underline underline-offset-2"
            >
              allow and deny lists
            </Link>{' '}
            override all of it.
          </p>
        </Section>

        <Section
          id="bin"
          icon="delete"
          title="The bin"
          summary="One irreversible action in the product, behind two deliberate steps."
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Binning a message sets a timestamp. Nothing is destroyed, attachments
            are untouched, and restoring it puts it back where it was. Emptying
            the bin removes the rows and the stored bytes, and that cannot be
            undone — which is why permanent deletion refuses any message that is
            not already binned. There is no path from the mail list to
            destruction in one action.
          </p>
        </Section>

        <Section
          id="api"
          icon="apiKeys"
          title="Using the API"
          summary="The same routes the dashboard uses. There is no private back door."
        >
          <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-[auto_1fr]">
            <Field label="Base URL">{env.APP_URL}</Field>
            <Field label="Auth">
              <code className="font-mono">Authorization: Bearer mp_live_…</code>{' '}
              — issue one under API Keys. Shown once, stored hashed.
            </Field>
            <Field label="Replay window">
              {env.WEBHOOK_REPLAY_WINDOW_SECONDS} seconds — receivers should
              reject deliveries older than this.
            </Field>
            <Field label="SDK">
              <code className="font-mono">@mailpiston/sdk</code> — types, a small
              client, and webhook verification. No dependencies and no{' '}
              <code className="font-mono">node:</code> imports, so it runs on the
              edge.
            </Field>
          </dl>

          <CopySnippet
            label="Next.js webhook route"
            value={`import { verifyWebhook } from '@mailpiston/sdk';\n\nexport async function POST(request: Request) {\n  const event = await verifyWebhook(\n    request,\n    process${'.env'}.MAILPISTON_ENDPOINT_SECRET!,\n  );\n\n  // Make downstream work idempotent with event.id.\n  console.log(event.id, event.data.subject);\n  return new Response('ok');\n}`}
          />

          <CopySnippet
            label="Send and reply"
            value={`import { MailpistonClient } from '@mailpiston/sdk';\n\nconst mail = new MailpistonClient({\n  baseUrl: '${env.APP_URL}',\n  apiKey: process${'.env'}.MAILPISTON_API_KEY!,\n});\n\nconst sent = await mail.send({\n  addressId: 'addr_...',\n  to: ['customer@example.com'],\n  subject: 'Thanks for writing in',\n  text: 'We are on it.',\n});\n\nawait mail.reply(sent.id, { text: 'One more thing…' });`}
          />

          <CopySnippet
            label="AI setup prompt"
            value={`Integrate MailPiston into this project. Use ${env.APP_URL} as MAILPISTON_API_URL. Add a POST webhook route that verifies the untouched request with verifyWebhook from @mailpiston/sdk and MAILPISTON_ENDPOINT_SECRET. Return 401 for invalid signatures, make processing idempotent using event.id, and return a 2xx response quickly. Use MailpistonClient with MAILPISTON_API_KEY and a configured addressId for sends and replies. Show every environment variable and file you change; never log secrets.`}
          />

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The dashboard authenticates with an operator session and the SDK with
            an API key, and both hit identical routes — so a bug in the public
            surface shows up in our own UI first.
          </p>
        </Section>
        </article>

        {/* MDN's "In this article" rail. Sticky, because the whole point of it
            is to stay reachable once you have scrolled away from the top. */}
        <aside className="docs-toc" aria-label="On this page">
          <p className="docs-toc__label">In this article</p>
          <nav>
            {CONTENTS.map((entry) => (
              <a key={entry.id} href={`#${entry.id}`}>
                {entry.label}
              </a>
            ))}
          </nav>
        </aside>
      </div>
    </>
  );
}

const PIPELINE = [
  {
    title: 'The provider delivers it to the ingress',
    body: 'Forward Email POSTs the message to this deployment, signed with its Webhook Signature Payload Verification Key. An unsigned or wrongly signed request is refused before capture or fan-out.',
  },
  {
    title: 'A MailPiston forwarding loop stops immediately',
    body: 'A notification generated by MailPiston carries X-Mailpiston-Forward. If it returns to ingress, it is recorded as rejected before storage or another provider send.',
  },
  {
    title: 'The recipient is resolved from the envelope',
    body: 'From the SMTP envelope, never the To: header — a message BCC’d to a managed address names nobody relevant in To:.',
  },
  {
    title: 'An unknown local part stops here',
    body: 'Recorded as email.rejected and dropped, never bounced. Bouncing would tell a spam run which addresses exist, and would send mail on your behalf to an address that has proven nothing.',
  },
  {
    title: 'Optional bytes are stored before their rows',
    body: 'Attachment bytes use object storage when attachments exist. Raw MIME is stored only when STORE_RAW_MIME is enabled. Message bodies, routes, threads, and events live in Postgres.',
  },
  {
    title: 'The conversation is resolved',
    body: 'From In-Reply-To and References headers only. A subject-and-participant fallback is deliberately not shipped: wrongly merging two customers’ threads is a data-leak-shaped bug.',
  },
  {
    title: 'The message, its attachments and its event are written together',
    body: 'One transaction, deduplicated on a fingerprint. A re-delivery hits the constraint and is reported as a duplicate rather than stored twice.',
  },
  {
    title: 'Fan-out to endpoints — unless it is quarantined',
    body: 'Each destination is isolated, so one unreachable application does not cost the others their delivery. Quarantined mail is durable but goes no further.',
  },
];

const VERDICTS = [
  {
    name: 'clean',
    variant: 'success' as const,
    body: 'Delivered normally and fanned out.',
  },
  {
    name: 'suspicious',
    variant: 'warning' as const,
    body: 'Delivered and fanned out, but marked — this is where the engine puts what it is unsure about.',
  },
  {
    name: 'spam',
    variant: 'danger' as const,
    body: 'Stored, hidden from the mail list, and not fanned out. No webhook fired and no inbox received it.',
  },
];

/**
 * The contents rail.
 *
 * Kept as a hand-written list rather than derived from the DOM: the sections
 * are a fixed, authored set, and a scroll-spy would be a client component and a
 * resize observer for a list that changes when someone edits this file.
 */
interface DocEntry {
  /** Matches the `id` of the Section it points at. */
  id: string;
  label: string;
  blurb: string;
}

const DOC_GROUPS: ReadonlyArray<{
  group: string;
  entries: readonly DocEntry[];
}> = [
  {
    group: 'How mail moves',
    entries: [
      {
        id: 'pipeline',
        label: 'Inbound pipeline',
        blurb: 'The guarded path between a provider POST, durable capture, and endpoint fan-out.',
      },
      {
        id: 'addresses',
        label: 'Addresses',
        blurb: 'Concrete aliases and local routes — which one the provider knows about, and why it matters.',
      },
      {
        id: 'endpoints',
        label: 'Endpoints',
        blurb: 'Where a delivered message is fanned out to: a signed webhook, or a verified mailbox.',
      },
    ],
  },
  {
    group: 'Keeping it correct',
    entries: [
      {
        id: 'drift',
        label: 'Drift and repair',
        blurb: 'When our record and the provider disagree, what reconciliation reports and what repair changes.',
      },
      {
        id: 'filtering',
        label: 'Spam filtering',
        blurb: 'Three verdicts, the signals behind each one, and why nothing is ever deleted.',
      },
      {
        id: 'bin',
        label: 'The bin',
        blurb: 'Soft delete, what stays recoverable, and the one action that is not.',
      },
    ],
  },
  {
    group: 'Building on it',
    entries: [
      {
        id: 'api',
        label: 'Using the API',
        blurb: 'The same routes the dashboard calls, the auth header, and the replay window receivers must enforce.',
      },
    ],
  },
];

/** Flattened for the contents rail, which wants one list rather than groups. */
const CONTENTS = DOC_GROUPS.flatMap((section) => section.entries);

function Section({
  id,
  icon,
  title,
  summary,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="docs-section">
      <h2>
        <span className="docs-section__icon" aria-hidden>
          <Icon name={icon} size={14} />
        </span>
        {title}
      </h2>
      <p className="docs-section__summary">{summary}</p>
      <div className="docs-section__body">{children}</div>
    </section>
  );
}

function DefinitionCard({
  title,
  badge,
  body,
  detail,
}: {
  title: string;
  badge: string;
  body: string;
  detail: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          <Badge variant="outline">{badge}</Badge>
        </CardTitle>
        <CardDescription className="leading-relaxed">{body}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-break-word">{children}</dd>
    </>
  );
}
