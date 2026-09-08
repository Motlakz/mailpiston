import { describe, expect, it } from 'vitest';

import { assertSafeWebhookUrl, isPrivateAddress } from './url-guard';

/**
 * The guard between an operator-supplied URL and this deployment's own network.
 *
 * These cases are the ranges an SSRF attempt actually reaches for. The metadata
 * service at 169.254.169.254 is the headline one, but loopback is how you talk
 * to the application itself, and a private range is whatever else shares the
 * VPC.
 */
describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'the rest of 127/8'],
    ['0.0.0.0', 'this network'],
    ['10.1.2.3', 'private class A'],
    ['172.16.0.1', 'private class B, low edge'],
    ['172.31.255.254', 'private class B, high edge'],
    ['192.168.1.1', 'private class C'],
    ['169.254.169.254', 'the cloud metadata service'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('rejects %s (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    ['::1', 'IPv6 loopback'],
    ['::', 'unspecified'],
    ['fd00::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['ff02::1', 'multicast'],
  ])('rejects %s (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  /**
   * The mapped forms matter more than they look: `::ffff:127.0.0.1` and
   * `::ffff:7f00:1` are the same packet arriving at the same loopback
   * interface, and a check that only understood dotted quads would wave the
   * second one through.
   */
  it.each([
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::127.0.0.1',
  ])('rejects %s, an IPv4 private address reached through IPv6', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '1.1.1.1',
    '2606:2800:220:1:248:1893:25c8:1946',
    '::ffff:93.184.216.34',
  ])('accepts the public address %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it('treats anything that is not an address at all as unsafe', () => {
    // Fail closed. A parser disagreement must not become a reachable target.
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });
});

describe('assertSafeWebhookUrl', () => {
  it('requires https', async () => {
    await expect(assertSafeWebhookUrl('http://93.184.216.34/hook')).rejects.toThrow(
      /must use https/,
    );
  });

  it('refuses credentials in the URL', async () => {
    // They would be sent on every delivery and appear in every log line that
    // records the endpoint.
    await expect(
      assertSafeWebhookUrl('https://user:pass@93.184.216.34/hook'),
    ).rejects.toThrow(/must not embed credentials/);
  });

  it('refuses a URL that is not absolute', async () => {
    await expect(assertSafeWebhookUrl('/hook')).rejects.toThrow(/valid absolute URL/);
  });

  it('refuses a literal private address', async () => {
    await expect(assertSafeWebhookUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /private address/,
    );
  });

  it('refuses a bracketed IPv6 loopback', async () => {
    await expect(assertSafeWebhookUrl('https://[::1]:8080/hook')).rejects.toThrow(
      /private address/,
    );
  });

  it('refuses a hostname that resolves to loopback', async () => {
    // The rebinding case, in its simplest form: the name is public-looking and
    // the answer is not. `localhost` resolves from the hosts file, so this
    // needs no network.
    await expect(assertSafeWebhookUrl('https://localhost/hook')).rejects.toThrow(
      /private address/,
    );
  });

  it('accepts a public address literal', async () => {
    const url = await assertSafeWebhookUrl('https://93.184.216.34/hook');
    expect(url.pathname).toBe('/hook');
  });
});
