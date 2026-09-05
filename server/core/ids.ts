import { customAlphabet } from 'nanoid';

/**
 * Prefixed, URL-safe, sortable-enough ids.
 *
 * A visible prefix means an id pasted into a bug report says what it is, and a
 * mis-wired foreign key fails loudly instead of silently pointing at the wrong
 * table. Base58-ish alphabet: no `0`/`O`/`I`/`l` to survive being read aloud.
 */
const alphabet = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const generate = customAlphabet(alphabet, 21);

export const ID_PREFIXES = {
  domain: 'dom',
  address: 'addr',
  endpoint: 'ep',
  recipient: 'rcpt',
  relay: 'rr',
  thread: 'thr',
  email: 'em',
  attachment: 'att',
  event: 'evt',
  delivery: 'dlv',
  apiKey: 'key',
  run: 'run',
  item: 'item',
  audit: 'aud',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${generate()}`;
}
