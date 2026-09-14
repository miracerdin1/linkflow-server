import dns from "dns";
import { isPrivateAddress } from "./url";

/**
 * Shared SSRF-safe outbound-request helpers.
 *
 * The pattern: resolve the hostname to its actual IPs once, reject if any of
 * them is a private/internal address (blocks DNS-rebinding), then pin the
 * HTTP client's DNS lookup to exactly those already-validated addresses so
 * the TCP connection cannot be redirected to a different (possibly private)
 * IP between the check and the request.
 *
 * Used by both the metadata scraper and the broken-link checker so every
 * outbound fetch in the server goes through the same protection.
 */

const dnsPromises = dns.promises;

export const assertPublicHostname = async (hostname: string) => {
  const addresses = await dnsPromises.lookup(hostname, { all: true });

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Cannot access internal network addresses.");
  }

  return addresses;
};

export const createSafeLookup = (allowedAddresses: dns.LookupAddress[]) => (
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => {
  const matchingAddress = allowedAddresses.find(({ family }) => !options.family || family === options.family);

  if (matchingAddress) {
    callback(null, matchingAddress.address, matchingAddress.family);
    return;
  }

  callback(Object.assign(new Error(`No safe address found for ${hostname}`), { code: "ENOTFOUND" }), "", 0);
};
