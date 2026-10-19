import type { SpamSignal } from '@/server/core/types';

/**
 * Rule names, as a person would say them.
 *
 * The full message page still shows the raw rule and score — that is where an
 * operator goes to audit the filter. A list row has room for one short phrase,
 * and "list_unsubscribe +35" is not one.
 */
const RULE_LABELS: Record<string, string> = {
  sender_denied: 'blocked sender',
  sender_blocked: 'blocked sender',
  operator_marked_spam: 'you marked it spam',
  dmarc_fail: 'failed DMARC',
  spf_fail: 'failed SPF',
  dkim_fail: 'bad signature',
  display_name_spoof: 'spoofed name',
  envelope_mismatch: 'envelope mismatch',
  urgency_lexicon: 'account-scare wording',
  link_text_mismatch: 'misleading link',
  link_to_ip: 'link to an IP',
  punycode_host: 'lookalike link',
  shortened_urgent_link: 'shortened link',
  executable_attachment: 'executable attachment',
  macro_attachment: 'macro attachment',
  password_protected_archive: 'locked archive',
  list_unsubscribe: 'bulk mail',
  esp_headers: 'bulk sender',
  bulk_precedence: 'bulk mail',
  marketing_language: 'marketing',
  image_heavy: 'image-only',
  body_not_language: 'gibberish',
  subject_not_language: 'gibberish subject',
  random_sender_local_part: 'random sender',
  cold_outreach_template: 'cold pitch',
  no_content: 'empty',
};

/** The two strongest reasons, deduplicated: "cold pitch · marketing". */
export function reasonsFor(signals: SpamSignal[]): string {
  const labels = signals
    .filter((signal) => signal.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((signal) => RULE_LABELS[signal.rule] ?? signal.rule.replace(/_/g, ' '));

  return [...new Set(labels)].slice(0, 2).join(' · ');
}

/**
 * When an unreviewed sender stops getting through, in the words a row can fit.
 *
 * The block is applied the next time they write after `at`, not at `at`
 * itself — there is no timer — so past the deadline the honest phrasing is
 * about their next attempt.
 */
export function autoBlockLabel(at: Date, now: Date = new Date()): string {
  const remaining = at.getTime() - now.getTime();
  if (remaining <= 0) return 'Blocked on next send';

  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  return hours < 24 ? `Blocks in ${hours}h` : `Blocks in ${Math.ceil(hours / 24)}d`;
}
