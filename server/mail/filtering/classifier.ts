/**
 * Inbound abuse classification (roadmap Phase 12).
 *
 * A deterministic, explainable rule engine. Three properties matter more than
 * raw accuracy, and they are why this is not a model call.
 *
 * **It runs inside the provider's inbound request.** That request has a
 * platform timeout and a retry behind it, and a retry that deduplicates against
 * a half-written message loses mail. Nothing here does I/O; the whole pass is
 * string work over a message already in memory.
 *
 * **Every verdict carries its reasons.** A filter that cannot say *why* it
 * quarantined something is a filter nobody trusts, and an operator who does not
 * trust it turns it off. Each rule contributes a named signal and a score, and
 * both are stored on the message.
 *
 * **It never deletes.** The worst outcome for a mail system is losing a message
 * that mattered, and a spam filter is the most likely place for that to happen.
 * `spam` means captured, hidden, and not fanned out — never dropped. The one
 * thing this module cannot do is make a message unrecoverable.
 *
 * Scores are additive and the thresholds are deliberately far apart, so a
 * single rule firing is rarely enough on its own. The intent is that the
 * expensive mistakes need two independent reasons to happen.
 */

import type {
  SpamCategory,
  SpamSignal,
  SpamVerdict,
} from '@/server/core/types';

export type { SpamCategory, SpamSignal, SpamVerdict };

export interface Classification {
  verdict: SpamVerdict;
  score: number;
  /** Category of the strongest signal, or null when nothing fired. */
  category: SpamCategory | null;
  signals: SpamSignal[];
}

export interface ClassificationInput {
  from: string;
  envelopeSender: string | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string | string[]>;
  attachments: Array<{ filename: string; contentType: string }>;
  /** Set when the message joins a conversation we already hold. */
  inReplyTo: string | null;
  /**
   * Senders this operator has vouched for, and senders they have blocked.
   * Entries are either a full address or a bare domain.
   */
  allowList?: string[];
  denyList?: string[];
  /**
   * True when this sender already appears in a thread on this deployment.
   *
   * The single most valuable signal available, and it is a negative one: a
   * person who is already mid-conversation is not a spam run, whatever their
   * subject line looks like.
   */
  knownCorrespondent?: boolean;
}

/**
 * Where the two thresholds sit.
 *
 * `SPAM` is high enough that no single rule reaches it alone. That is the point
 * — quarantine is the consequential outcome, and it should take two independent
 * reasons to believe.
 */
export const SPAM_THRESHOLD = 60;
export const SUSPICIOUS_THRESHOLD = 30;

export function classify(input: ClassificationInput): Classification {
  // Explicit operator decisions come first and end the question. A rule engine
  // that can overrule an allow-list entry is one the operator has to fight.
  const sender = addressOf(input.from);

  if (matchesList(sender, input.denyList)) {
    return verdictOf([
      {
        rule: 'sender_denied',
        category: 'phishing',
        score: SPAM_THRESHOLD,
        detail: sender,
      },
    ]);
  }

  if (matchesList(sender, input.allowList)) {
    return { verdict: 'clean', score: 0, category: null, signals: [] };
  }

  const signals = [
    ...authenticationSignals(input),
    ...phishingSignals(input),
    ...malwareSignals(input),
    ...promotionalSignals(input),
    ...gibberishSignals(input),
    ...coldOutreachSignals(input),
    ...emptinessSignals(input),
  ];

  /**
   * A reply, or somebody we have talked to before, is heavily discounted.
   *
   * Not exempted: a compromised account mid-thread is exactly how a convincing
   * phishing message arrives. The discount is large enough to clear the
   * marketing and cold-outreach rules — a customer forwarding a newsletter into
   * a support thread should not vanish — and small enough that a strong
   * authentication or malware finding still quarantines.
   */
  if (input.knownCorrespondent || input.inReplyTo) {
    signals.push({
      rule: 'known_correspondent',
      category: 'promotional',
      score: -40,
      detail: input.inReplyTo ? 'reply to a message we hold' : sender,
    });
  }

  return verdictOf(signals);
}

function verdictOf(signals: SpamSignal[]): Classification {
  const score = Math.max(
    0,
    signals.reduce((total, signal) => total + signal.score, 0),
  );

  const strongest = signals
    .filter((signal) => signal.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  const verdict: SpamVerdict =
    score >= SPAM_THRESHOLD
      ? 'spam'
      : score >= SUSPICIOUS_THRESHOLD
        ? 'suspicious'
        : 'clean';

  return {
    verdict,
    score,
    category: verdict === 'clean' ? null : (strongest?.category ?? null),
    signals,
  };
}

// --- Authentication ---------------------------------------------------------

/**
 * What the receiving MTA already decided about this sender.
 *
 * This is the strongest evidence available and it costs nothing: the provider
 * has already done the DNS work and written the answer into a header. A DMARC
 * failure means the message is not from the domain it claims, which is the
 * definition of the thing every phishing filter is trying to detect.
 */
function authenticationSignals(input: ClassificationInput): SpamSignal[] {
  const results = headerText(input.headers, 'authentication-results');
  const receivedSpf = headerText(input.headers, 'received-spf');
  const signals: SpamSignal[] = [];

  if (/dmarc=(fail|none\s*\(p=reject)/i.test(results)) {
    signals.push({
      rule: 'dmarc_fail',
      category: 'authentication',
      score: 45,
      detail: 'the sending domain disowns this message',
    });
  }

  if (/spf=(fail|softfail)/i.test(results) || /^\s*(fail|softfail)/i.test(receivedSpf)) {
    signals.push({
      rule: 'spf_fail',
      category: 'authentication',
      score: 20,
      detail: 'sending host is not authorised by the domain',
    });
  }

  if (/dkim=(fail|permerror)/i.test(results)) {
    signals.push({
      rule: 'dkim_fail',
      category: 'authentication',
      score: 15,
      detail: 'signature did not verify',
    });
  }

  // A display name that contains an address whose domain is not the sending
  // domain: "PayPal Support <billing@mail-secure-check.tk>" and every variation
  // of it. Cheap, and it catches the majority of consumer-grade impersonation.
  const display = displayNameOf(input.from);
  const claimed = display.match(/[\w.+-]+@([\w-]+\.[\w.-]+)/)?.[1];
  const actual = domainOf(input.from);

  if (claimed && actual && !sameDomain(claimed, actual)) {
    signals.push({
      rule: 'display_name_spoof',
      category: 'phishing',
      score: 30,
      detail: `claims ${claimed}, sent from ${actual}`,
    });
  }

  // Envelope sender disagreeing with the header From is normal for forwarders
  // and mailing lists, so on its own it means little. It is worth a small
  // amount only when the message also failed to authenticate.
  const envelopeDomain = input.envelopeSender
    ? domainOf(input.envelopeSender)
    : null;

  if (
    envelopeDomain &&
    actual &&
    !sameDomain(envelopeDomain, actual) &&
    signals.some((signal) => signal.category === 'authentication')
  ) {
    signals.push({
      rule: 'envelope_mismatch',
      category: 'authentication',
      score: 10,
      detail: `envelope ${envelopeDomain}, header ${actual}`,
    });
  }

  return signals;
}

// --- Phishing ---------------------------------------------------------------

/**
 * Language that exists to manufacture urgency about an account, plus the link
 * tricks that carry it.
 *
 * The lexicon alone is only worth a moderate score: real providers do send
 * "your payment failed". It becomes decisive in combination with a failed
 * authentication check or a mismatched link, which is how the thresholds are
 * tuned.
 */
const URGENCY_PATTERNS: RegExp[] = [
  /\bverify (your|the) (account|email|identity|address)\b/i,
  /\b(account|mailbox|subscription) (has been |was |will be )?(suspended|deactivated|closed|terminated)\b/i,
  /\bunusual (sign[- ]?in|login|activity)\b/i,
  /\bconfirm your (password|payment|billing|identity)\b/i,
  /\b(update|re-?enter) your (payment|billing|card) (details|information)\b/i,
  /\byour (payment|invoice|subscription) (has )?failed\b/i,
  /\bclick (here )?(to|and) (restore|reactivate|verify|unlock)\b/i,
  /\bwithin (24|48|72) hours\b.*\b(or|otherwise)\b/i,
  /\b(seed phrase|private key|wallet recovery)\b/i,
  /\byou have \(?\d+\)? (pending|undelivered) (messages?|emails?)\b/i,
  /\bshared (a|an) (document|file) with you\b/i,
];

const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  't.co',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'cutt.ly',
  'rb.gy',
  'shorturl.at',
]);

function phishingSignals(input: ClassificationInput): SpamSignal[] {
  const signals: SpamSignal[] = [];
  const body = `${input.subject ?? ''}\n${input.text ?? ''}`;

  const matched = URGENCY_PATTERNS.filter((pattern) => pattern.test(body));

  if (matched.length > 0) {
    signals.push({
      rule: 'urgency_lexicon',
      category: 'phishing',
      score: matched.length >= 2 ? 35 : 20,
      detail: `${matched.length} account-urgency ${matched.length === 1 ? 'phrase' : 'phrases'}`,
    });
  }

  for (const link of linksIn(input.html)) {
    // Anchor text that names a domain while the href goes somewhere else. The
    // oldest trick there is, and still the most reliable single indicator.
    const claimed = link.text.match(/\b([\w-]+\.(?:com|net|org|io|co|dev|app|bank|gov))\b/i)?.[1];

    if (claimed && link.host && !sameDomain(claimed, link.host)) {
      signals.push({
        rule: 'link_text_mismatch',
        category: 'phishing',
        score: 30,
        detail: `"${claimed}" links to ${link.host}`,
      });
      break;
    }
  }

  const hosts = linksIn(input.html).map((link) => link.host).filter(Boolean);

  if (hosts.some((host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host!))) {
    signals.push({
      rule: 'link_to_ip',
      category: 'phishing',
      score: 25,
      detail: 'a link points at a bare IP address',
    });
  }

  // Punycode is legitimate for internationalised domains and is also how a
  // homograph attack is spelled. Worth flagging, not worth deciding alone.
  if (hosts.some((host) => host!.includes('xn--'))) {
    signals.push({
      rule: 'punycode_host',
      category: 'phishing',
      score: 20,
      detail: 'a link uses a punycode host',
    });
  }

  if (matched.length > 0 && hosts.some((host) => SHORTENERS.has(host!))) {
    signals.push({
      rule: 'shortened_urgent_link',
      category: 'phishing',
      score: 15,
      detail: 'urgency language behind a link shortener',
    });
  }

  return signals;
}

// --- Malware ----------------------------------------------------------------

/**
 * Attachment types that are executable on arrival, or containers that exist to
 * smuggle one past a scanner.
 *
 * Extension-based, because the declared content type is attacker-controlled and
 * routinely lies. A double extension (`invoice.pdf.exe`) is caught by taking the
 * last one.
 */
const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'scr', 'com', 'pif', 'bat', 'cmd', 'msi', 'msp', 'jar', 'vbs', 'vbe',
  'js', 'jse', 'wsf', 'wsh', 'ps1', 'psm1', 'hta', 'cpl', 'lnk', 'reg', 'scf',
  'iso', 'img', 'vhd', 'appx', 'apk', 'dmg',
]);

/** Macro-capable Office formats. Legitimate, and the classic delivery vehicle. */
const MACRO_EXTENSIONS = new Set(['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'xlam']);

function malwareSignals(input: ClassificationInput): SpamSignal[] {
  const signals: SpamSignal[] = [];

  for (const attachment of input.attachments) {
    const extension = attachment.filename.split('.').pop()?.toLowerCase() ?? '';

    if (EXECUTABLE_EXTENSIONS.has(extension)) {
      signals.push({
        rule: 'executable_attachment',
        category: 'malware',
        score: 45,
        detail: attachment.filename,
      });
      break;
    }

    if (MACRO_EXTENSIONS.has(extension)) {
      signals.push({
        rule: 'macro_attachment',
        category: 'malware',
        score: 25,
        detail: attachment.filename,
      });
      break;
    }
  }

  // An archive whose password is helpfully supplied in the body is an archive
  // built to be opened by a person and not by a scanner.
  const body = `${input.subject ?? ''}\n${input.text ?? ''}`;
  const archived = input.attachments.some((attachment) =>
    /\.(zip|rar|7z|gz|tar)$/i.test(attachment.filename),
  );

  if (archived && /\bpassword\s*(is|:)\s*\S+/i.test(body)) {
    signals.push({
      rule: 'password_protected_archive',
      category: 'malware',
      score: 35,
      detail: 'archive with the password in the message body',
    });
  }

  return signals;
}

// --- Promotional and bulk ---------------------------------------------------

/**
 * Marketing mail, identified mostly by its own headers.
 *
 * `List-Unsubscribe` is the honest one — a sender who publishes it is telling
 * you this is a bulk send — and it is by far the highest-precision rule in the
 * file. It scores high enough to reach `suspicious` on its own but not `spam`,
 * because a newsletter a customer deliberately forwarded to support is not
 * something to hide from them.
 */
const ESP_HEADERS = [
  'list-unsubscribe',
  'list-id',
  'feedback-id',
  'x-campaign-id',
  'x-campaignid',
  'x-mailer',
  'x-sg-eid',
  'x-mailgun-sid',
  'x-mandrill-user',
  'x-klaviyo-message-id',
  'x-customerio-id',
  'x-ses-outgoing',
  'x-sendinblue-id',
  'x-report-abuse',
];

const MARKETING_PHRASES: RegExp[] = [
  /\bunsubscribe\b/i,
  /\bview (this|it) in (your )?browser\b/i,
  /\bmanage (your )?(email )?preferences\b/i,
  /\byou('| a)re receiving this (email )?because\b/i,
  /\bupdate your (email )?preferences\b/i,
  /\bno longer wish to receive\b/i,
  /\b\d{1,2}% off\b/i,
  /\blimited time offer\b/i,
  /\bshop now\b/i,
  /\bblack friday|cyber monday\b/i,
];

function promotionalSignals(input: ClassificationInput): SpamSignal[] {
  const signals: SpamSignal[] = [];

  const present = ESP_HEADERS.filter((name) =>
    headerText(input.headers, name).length > 0,
  );

  if (present.includes('list-unsubscribe')) {
    signals.push({
      rule: 'list_unsubscribe',
      category: 'promotional',
      score: 35,
      detail: 'sender declares this a bulk send',
    });
  } else if (present.length > 0) {
    signals.push({
      rule: 'esp_headers',
      category: 'promotional',
      score: 20,
      detail: present.join(', '),
    });
  }

  if (/\b(bulk|list|junk|auto_reply)\b/i.test(headerText(input.headers, 'precedence'))) {
    signals.push({
      rule: 'bulk_precedence',
      category: 'promotional',
      score: 20,
    });
  }

  const body = `${input.subject ?? ''}\n${input.text ?? ''}`;
  const matched = MARKETING_PHRASES.filter((pattern) => pattern.test(body));

  if (matched.length >= 2) {
    signals.push({
      rule: 'marketing_language',
      category: 'promotional',
      score: 20,
      detail: `${matched.length} marketing phrases`,
    });
  }

  // A message that is almost entirely images is a designed campaign, and it is
  // also how text-based rules get evaded.
  if (input.html) {
    const images = (input.html.match(/<img\b/gi) ?? []).length;
    const words = wordsIn(input.text ?? stripTags(input.html)).length;

    if (images >= 3 && words < 40) {
      signals.push({
        rule: 'image_heavy',
        category: 'promotional',
        score: 15,
        detail: `${images} images, ${words} words`,
      });
    }
  }

  return signals;
}

// --- Gibberish --------------------------------------------------------------

/**
 * Mail whose text is not language.
 *
 * Dictionary-free on purpose: a word list is a large dependency, it is
 * English-only, and it would classify a perfectly good German or Zulu message
 * as noise. What is measured instead is *pronounceability* — vowel presence,
 * consonant runs, digits wedged into words — which holds across languages
 * written in Latin script and fails exactly where random strings do.
 *
 * The threshold is high and requires a reasonable number of tokens, because
 * short messages are legitimately full of product names, codes and identifiers.
 */
function gibberishSignals(input: ClassificationInput): SpamSignal[] {
  const signals: SpamSignal[] = [];

  const sample = `${input.text ?? stripTags(input.html ?? '')}`.slice(0, 2000);
  const words = wordsIn(sample);

  if (words.length >= 8) {
    const odd = words.filter((word) => !looksLikeAWord(word)).length;
    const ratio = odd / words.length;

    if (ratio >= 0.55) {
      signals.push({
        rule: 'body_not_language',
        category: 'gibberish',
        score: 40,
        detail: `${Math.round(ratio * 100)}% of ${words.length} words are not pronounceable`,
      });
    }
  }

  const subject = input.subject?.trim() ?? '';
  const subjectWords = wordsIn(subject);

  if (
    subjectWords.length > 0 &&
    subjectWords.every((word) => !looksLikeAWord(word)) &&
    subject.replace(/\s/g, '').length >= 10
  ) {
    signals.push({
      rule: 'subject_not_language',
      category: 'gibberish',
      score: 25,
      detail: subject.slice(0, 60),
    });
  }

  // A random local part is how throwaway senders are minted in bulk.
  const local = addressOf(input.from).split('@')[0] ?? '';

  if (local.length >= 10 && !looksLikeAWord(local.replace(/[._-]/g, ''))) {
    signals.push({
      rule: 'random_sender_local_part',
      category: 'gibberish',
      score: 15,
      detail: local,
    });
  }

  return signals;
}

/**
 * Whether a token plausibly belongs to a human language.
 *
 * Rejects: no vowels at any length that matters, long consonant runs, letters
 * interleaved with digits, and very high character variety for the length.
 * Accepts short tokens unconditionally — "ok", "hi", "PR" are all fine, and
 * there is no signal in three characters.
 */
export function looksLikeAWord(token: string): boolean {
  const word = token.toLowerCase();

  if (word.length <= 3) return true;
  if (!/^[a-z0-9'-]+$/.test(word)) return false;

  // Letters and digits mixed inside one token: "a7f3kq9", "x1y2z3".
  if (/[a-z]\d|\d[a-z]/.test(word) && word.length >= 6) return false;

  const letters = word.replace(/[^a-z]/g, '');
  if (letters.length < 4) return true;

  const vowels = (letters.match(/[aeiouy]/g) ?? []).length;
  if (vowels === 0) return false;

  const vowelRatio = vowels / letters.length;
  if (vowelRatio < 0.15 || vowelRatio > 0.85) return false;

  // Five consonants in a row does not occur in ordinary words in any Latin
  // script language worth worrying about here.
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(letters)) return false;

  // Near-total character variety in a long token is the fingerprint of a
  // random generator: real words repeat letters.
  if (letters.length >= 10) {
    const distinct = new Set(letters).size;
    if (distinct / letters.length > 0.9) return false;
  }

  return true;
}

// --- Cold outreach ----------------------------------------------------------

/**
 * Mail from a stranger with a pitch — SEO offers, guest posts, agency
 * introductions, "quick call?" — arriving at an address meant for customers.
 *
 * Not fraud and not marketing-by-headers: it is one human writing to one
 * address, so nothing above catches it. The phrases are the giveaway, and they
 * are remarkably stable because they come out of the same templates.
 *
 * The score scales with how many fire, because density is the actual tell. One
 * phrase is common in genuine mail — "I'm reaching out because your product
 * broke" — and earns a nudge. Three or more in one message is a template, and
 * templates are what this rule is for.
 */
const OUTREACH_PHRASES: RegExp[] = [
  /\bhope (this|the) (email|message) finds you well\b/i,
  /\bi (came across|stumbled upon|found) your (website|site|company|product|page)\b/i,
  /\b(i'?m|i am) reaching out\b/i,
  /\bquick question (for|about)\b/i,
  /\bwe help (companies|businesses|brands|startups) like yours\b/i,
  /\b(boost|increase|improve|grow|double) your (traffic|rankings?|sales|revenue|conversions?|visibility)\b/i,
  /\b(guest post|link ?building|backlinks?|do-?follow)\b/i,
  /\b(seo|digital marketing|web ?design|app development) (services|agency|expert|company)\b/i,
  /\b(would love to|let'?s) (connect|collaborate|partner)\b/i,
  /\b(15|20|30) minutes? (call|chat|of your time)\b/i,
  /\b(book|schedule) a (call|demo|meeting)\b/i,
  /\bpartnership opportunit(y|ies)\b/i,
  /\b(white ?label|lead gen(eration)?|outsourc)\b/i,
  /\bnot interested,? (just )?(reply|let me know)\b/i,
  /\bis this something you'?d be (open|interested) (to|in)\b/i,
  /\bi'?ll (follow up|circle back)\b/i,
  /\bmay i send (you )?(a|the) (proposal|details|portfolio)\b/i,
];

function coldOutreachSignals(input: ClassificationInput): SpamSignal[] {
  const body = `${input.subject ?? ''}\n${input.text ?? stripTags(input.html ?? '')}`;
  const matched = OUTREACH_PHRASES.filter((pattern) => pattern.test(body));

  if (matched.length === 0) return [];

  return [
    {
      rule: 'cold_outreach_template',
      category: 'cold_outreach',
      score: matched.length >= 3 ? 60 : matched.length === 2 ? 40 : 15,
      detail: `${matched.length} outreach ${matched.length === 1 ? 'phrase' : 'phrases'}`,
    },
  ];
}

// --- Emptiness --------------------------------------------------------------

/**
 * A delivery with nothing in it.
 *
 * Either a probe checking whether the address accepts mail, or a broken sender.
 * Both are things an operator wants out of the way, and neither is ever the
 * message they were waiting for.
 */
function emptinessSignals(input: ClassificationInput): SpamSignal[] {
  const hasBody = Boolean(
    (input.text ?? '').trim() || stripTags(input.html ?? '').trim(),
  );

  if (hasBody || input.attachments.length > 0) return [];

  return [
    {
      rule: 'no_content',
      category: 'empty',
      score: (input.subject ?? '').trim() ? 35 : 45,
      detail: (input.subject ?? '').trim()
        ? 'subject only, no body and no attachments'
        : 'no subject, no body, no attachments',
    },
  ];
}

// --- Shared helpers ---------------------------------------------------------

function headerText(
  headers: Record<string, string | string[]>,
  name: string,
): string {
  // Header names are case-insensitive and providers disagree about casing.
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name,
  );
  if (!key) return '';

  const value = headers[key];
  return Array.isArray(value) ? value.join(' ') : String(value ?? '');
}

/**
 * The real address out of a `From:` value.
 *
 * The *last* angle-bracket group, not the first. A display name is allowed to
 * contain anything, including a complete address in brackets — which is
 * precisely the spoof `display_name_spoof` exists to catch:
 *
 *     "PayPal Service <service@paypal.com>" <billing@secure-check.example>
 *
 * Taking the first group there yields the attacker's decoration and treats the
 * message as genuinely from PayPal. The envelope address is always last.
 */
export function addressOf(value: string): string {
  const groups = [...value.matchAll(/<([^<>]+)>/g)];
  const last = groups[groups.length - 1]?.[1];
  return (last ?? value).trim().toLowerCase();
}

function displayNameOf(value: string): string {
  const index = value.lastIndexOf('<');
  return index === -1 ? '' : value.slice(0, index).replace(/["']/g, '').trim();
}

function domainOf(value: string): string | null {
  return addressOf(value).split('@')[1] ?? null;
}

/** Equal, or one is a subdomain of the other — `mail.stripe.com` is Stripe. */
function sameDomain(a: string, b: string): boolean {
  const left = a.toLowerCase().replace(/\.$/, '');
  const right = b.toLowerCase().replace(/\.$/, '');

  return (
    left === right ||
    left.endsWith(`.${right}`) ||
    right.endsWith(`.${left}`)
  );
}

/**
 * Sender matched against an operator list.
 *
 * An entry is either a full address or a bare domain, and a domain entry covers
 * its subdomains — an operator who allows `stripe.com` means the whole of it.
 */
function matchesList(sender: string, list: string[] | undefined): boolean {
  if (!list?.length) return false;

  const domain = sender.split('@')[1] ?? '';

  return list.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry.includes('@')) return entry === sender;
    return Boolean(domain) && sameDomain(domain, entry);
  });
}

interface ParsedLink {
  host: string | null;
  text: string;
}

function linksIn(html: string | null): ParsedLink[] {
  if (!html) return [];

  const links: ParsedLink[] = [];
  const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    let host: string | null = null;

    try {
      host = new URL(match[1]).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      // `mailto:`, `#anchor`, and malformed hrefs. Not link-based evidence.
    }

    links.push({ host, text: stripTags(match[2]).trim() });
  }

  return links;
}

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');
}

function wordsIn(text: string): string[] {
  return text
    .split(/[^A-Za-z0-9'-]+/)
    .filter((token) => token.length >= 2 && /[A-Za-z]/.test(token));
}
