/** Returns a same-origin path, never an absolute or protocol-relative URL. */
export function safeInternalRedirect(
  candidate: string | null | undefined,
  fallback = '/overview',
): string {
  if (!candidate || !candidate.startsWith('/')) return fallback;

  try {
    const base = new URL('https://mailpiston.invalid');
    const resolved = new URL(candidate, base);

    if (resolved.origin !== base.origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
