import 'server-only';

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

import { env } from '@/server/core/config';
import { ValidationError } from '@/server/core/errors';

/**
 * SSRF guard for operator-supplied endpoint URLs (roadmap Phase 7).
 *
 * A webhook URL is a request this deployment makes on someone else's
 * instruction, which is the whole shape of server-side request forgery. The
 * dangerous targets are not exotic: `http://169.254.169.254/` is the cloud
 * metadata service, `http://127.0.0.1:3000/` is this application, and a private
 * range is whatever else shares the network.
 *
 * The check runs **twice** — when the endpoint is configured, and again
 * immediately before every delivery. Configuration-time alone is not enough: a
 * hostname that resolved publicly when it was saved can be repointed at
 * `127.0.0.1` afterwards, which is DNS rebinding, and the second check is what
 * makes that pointless.
 *
 * One residual gap is worth naming rather than hiding: `fetch` performs its own
 * resolution, so a record that changes between our lookup and its lookup is not
 * covered. Closing that needs a custom agent that dials the address we
 * validated, which is a larger change than this phase carries. The window is
 * milliseconds wide and the attacker must already control DNS for a hostname
 * the operator typed in themselves.
 */

/** Ranges that must never be reachable from a configured endpoint. */
function isPrivateIPv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true; // Unparseable is not provably public.
  }

  const [a, b] = octets as [number, number, number, number];

  return (
    a === 0 || //                 0.0.0.0/8      "this network"
    a === 10 || //                10.0.0.0/8     private
    a === 127 || //               127.0.0.0/8    loopback
    (a === 100 && b >= 64 && b < 128) || // 100.64.0.0/10  carrier NAT
    (a === 169 && b === 254) || //          169.254.0.0/16 link-local, incl. metadata
    (a === 172 && b >= 16 && b < 32) || //  172.16.0.0/12  private
    (a === 192 && b === 168) || //          192.168.0.0/16 private
    (a === 192 && b === 0) || //            192.0.0.0/24   IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    a >= 224 //                   224.0.0.0/4 multicast and 240.0.0.0/4 reserved
  );
}

/** Expands any IPv6 form to its eight 16-bit groups. */
function expandIPv6(address: string): number[] | null {
  const [head, tail] = address.split('%')[0].split('::');
  const parse = (part: string) =>
    part ? part.split(':').filter(Boolean) : [];

  const left = parse(head ?? '');
  const right = parse(tail ?? '');

  // A trailing dotted-quad (::ffff:127.0.0.1) occupies two groups.
  const expand = (parts: string[]): string[] =>
    parts.flatMap((part) => {
      if (!part.includes('.')) return [part];

      const octets = part.split('.').map(Number);
      if (octets.length !== 4) return [part];

      return [
        ((octets[0] << 8) | octets[1]).toString(16),
        ((octets[2] << 8) | octets[3]).toString(16),
      ];
    });

  const leftGroups = expand(left);
  const rightGroups = expand(right);

  if (tail === undefined) {
    return leftGroups.length === 8 ? leftGroups.map((g) => parseInt(g, 16)) : null;
  }

  const fill = 8 - leftGroups.length - rightGroups.length;
  if (fill < 0) return null;

  return [...leftGroups, ...Array(fill).fill('0'), ...rightGroups].map((g) =>
    parseInt(g, 16),
  );
}

function isPrivateIPv6(address: string): boolean {
  const groups = expandIPv6(address);
  if (!groups || groups.some((group) => Number.isNaN(group))) return true;

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  if (groups.every((group) => group === 0)) return true; //          ::
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return true; // ::1

  // IPv4 reached through IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d),
  // and NAT64 (64:ff9b::a.b.c.d) all deliver packets to an IPv4 host, so the
  // embedded address is what actually has to be judged.
  const embedded = (high: number, low: number) =>
    [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isPrivateIPv4(embedded(g6, g7));
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIPv4(embedded(g6, g7));
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIPv4(embedded(g6, g7));
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8  multicast

  return false;
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true; // Not an IP at all: treat as unsafe rather than as public.
}

/**
 * Validates a webhook target and returns the URL it resolved safely to.
 *
 * Throws `ValidationError` so a bad URL is a 400 at configuration time and a
 * recorded delivery failure at delivery time, rather than a 500 either way.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<URL> {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError('Endpoint URL is not a valid absolute URL');
  }

  const insecureAllowed = env.WEBHOOK_ALLOW_INSECURE_TARGETS;

  if (url.protocol !== 'https:' && !(insecureAllowed && url.protocol === 'http:')) {
    throw new ValidationError('Endpoint URL must use https');
  }

  // Credentials in the URL would be sent on every delivery and would appear in
  // every log line that records the endpoint.
  if (url.username || url.password) {
    throw new ValidationError('Endpoint URL must not embed credentials');
  }

  if (!url.hostname) {
    throw new ValidationError('Endpoint URL must name a host');
  }

  if (insecureAllowed) return url;

  // `[::1]` arrives bracketed from the URL parser.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new ValidationError(
        `Endpoint URL resolves to a private address (${hostname})`,
      );
    }
    return url;
  }

  let resolved: Array<{ address: string }>;

  try {
    resolved = await lookup(hostname, { all: true });
  } catch {
    throw new ValidationError(`Endpoint host ${hostname} does not resolve`);
  }

  if (resolved.length === 0) {
    throw new ValidationError(`Endpoint host ${hostname} does not resolve`);
  }

  // *Every* answer has to be public. A hostname with one public and one private
  // record is a rebinding attack that succeeds whenever the resolver happens to
  // hand back the private one.
  for (const { address } of resolved) {
    if (isPrivateAddress(address)) {
      throw new ValidationError(
        `Endpoint host ${hostname} resolves to a private address (${address})`,
      );
    }
  }

  return url;
}
