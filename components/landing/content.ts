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
    answer: "That is a core planned workflow. MailPiston forwards or notifies your private destination, then converts an authorized reply into a thread-aware message from the public support identity. The production design includes header rewriting, signed reply tokens, loop prevention, and sender authorization so your private address does not become the visible sender.",
  },
  {
    question: "Does this work for every domain I manage?",
    answer: "Yes. The architecture is domain-general. Once a domain and sending identity are verified, the same endpoint, routing, inbox, and reply concepts can be reused across its addresses.",
  },
  {
    question: "Do I have to self-host the mail infrastructure?",
    answer: "No. The point is to own the valuable control layer without becoming a mail operator. MailPiston is designed to use established providers for the hard transport work and to keep that provider boundary replaceable.",
  },
  {
    question: "Is hosted access available now?",
    answer: "Not yet. MailPiston is an internal-first private build. The pricing section is an explicit planning signal for a possible hosted version, not a live offer or checkout.",
  },
];

export const landingPageStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "MailPiston",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: "An ownership-first email control plane for receiving, routing, viewing, and replying across every domain you manage.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Private owner build; external hosted access is not yet for sale.",
  },
};
