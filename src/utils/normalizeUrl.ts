/**
 * Normalizes a URL for duplicate comparison: ignores protocol, a leading
 * "www.", and a trailing slash, but keeps path/query (so
 * example.com/a and example.com/b are still distinct). Returns null for
 * unparsable input.
 */
export const normalizeUrlForCompare = (rawUrl: string): string | null => {
  try {
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);

    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);

    const pathname = parsed.pathname.replace(/\/+$/, "");

    return `${host}${pathname}${parsed.search}`.toLowerCase();
  } catch {
    return null;
  }
};
