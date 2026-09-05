import { Database01Icon, ShieldKeyIcon, WorkflowCircle01Icon } from "@hugeicons/core-free-icons";

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
];

export const frequentlyAskedQuestions = [
  {
    question: "Is MailPiston another email delivery provider?",
    answer: "No. MailPiston is the control plane above a delivery provider. It owns your application workflow, identities, routes, messages, and threads while a specialist handles SMTP, MX, spam filtering, and delivery operations.",
  },
  {
    question: "Can I receive support mail and reply from my personal inbox?",
    answer: "Yes - it is the workflow MailPiston is built around. It forwards the message to your private destination, then turns your authorized reply into a thread-aware message from the public support identity. Header rewriting, signed reply tokens, loop prevention, and strict sender matching keep your private address off the wire entirely.",
  },
  {
    question: "Does this work for every domain I manage?",
    answer: "Yes. The architecture is domain-general and nothing in it scales with domain count. Once a domain and sending identity are verified, the same endpoint, routing, inbox, and reply concepts apply across all of its addresses.",
  },
  {
    question: "Do I have to self-host the mail infrastructure?",
    answer: "No. The point is to own the valuable control layer without becoming a mail operator. MailPiston uses established providers for the hard transport work, behind a boundary that stays replaceable - no controller, component, or repository knows which provider is underneath.",
  },
  {
    question: "What happens if I want to leave, or switch provider?",
    answer: "Your messages, threads, routes, and events are rows in your own Postgres database, and attachments are objects in your own bucket. Switching delivery providers means implementing one interface; leaving means taking a database with you.",
  },
  {
    question: "What does it actually cost to run?",
    answer: "You pay your delivery provider, your database, and your object storage directly, at their prices. Enhanced Protection at Forward Email covers unlimited domains and aliases for a few dollars a month, so the bill tracks mail volume rather than how many domains you added.",
  },
];

export const landingPageStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "MailPiston",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://mailpiston.vercel.app",
  description: "An ownership-first email control plane for receiving, routing, viewing, and replying across every domain you manage.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Self-hosted: no MailPiston product fee. Infrastructure is billed directly by the providers you choose.",
  },
};
