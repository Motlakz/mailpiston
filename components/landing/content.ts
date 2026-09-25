import { Database01Icon, Exchange01Icon, ShieldKeyIcon, WorkflowCircle01Icon } from "@hugeicons/core-free-icons";

export const benefits = [
  {
    icon: Database01Icon,
    title: "Keep the canonical record",
    copy: "Inbound and outbound mail live in one thread model you control - not scattered across private inboxes and provider dashboards.",
  },
  {
    icon: ShieldKeyIcon,
    title: "Protect private identities",
    copy: "Forward a message to the mailbox you already use, then relay the reply through the public address your customer expects.",
  },
  {
    icon: WorkflowCircle01Icon,
    title: "Route on your terms",
    copy: "Send each address to a webhook, a private inbox, a group, or a combination - without changing the underlying conversation.",
  },
  {
    icon: Exchange01Icon,
    title: "Swap the transport layer",
    copy: "Move between delivery providers at the adapter boundary. Your routes, message history, and product workflow do not move with it.",
  },
];

export const frequentlyAskedQuestions = [
  {
    question: "Is MailPiston another email delivery provider?",
    answer: "No. MailPiston is the control plane above a delivery provider. It owns your application workflow, identities, routes, messages, and threads while a specialist handles SMTP, MX, spam filtering, and delivery operations.",
  },
  {
    question: "Can I receive support mail and reply from my personal inbox?",
    answer: "Yes. Bind a verified personal-inbox endpoint, then select one of your verified domains for replies on the Domains dashboard. MailPiston sends a constructed notification with an opaque Reply-To address; your reply returns through MailPiston and leaves from the managed address. Forwarding is disabled when that safe route is missing.",
  },
  {
    question: "Does this work for every domain I manage?",
    answer: "The same routing model works across multiple verified domains. Each domain still needs its own DNS and provider configuration, and each sending address needs a concrete provider alias; MailPiston shows and reconciles those records per domain.",
  },
  {
    question: "Do I have to self-host the mail infrastructure?",
    answer: "No. The point is to own the valuable control layer without becoming a mail operator. MailPiston uses established providers for the hard transport work, behind a boundary that stays replaceable - no controller, component, or repository knows which provider is underneath.",
  },
  {
    question: "What happens if I want to leave, or switch provider?",
    answer: "Messages, threads, routes, and events are stored in the Postgres database configured for this deployment. Attachment bytes—and raw MIME only when raw capture is enabled—use the configured object store. The provider adapter limits transport coupling, but a provider migration still requires implementation and validation work.",
  },
  {
    question: "What does it actually cost to run?",
    answer: "A self-hosted deployment pays its mail provider, database, hosting, retry service, and any object storage directly. The exact total depends on the providers and message volume; MailPiston does not promise a fixed infrastructure price.",
  },
];

export const landingPageStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "MailPiston",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://mailpiston.com",
  description: "An ownership-first email control plane for receiving, routing, viewing, and replying across every domain you manage.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Self-hosted: no MailPiston product fee. Infrastructure is billed directly by the providers you choose.",
  },
};
