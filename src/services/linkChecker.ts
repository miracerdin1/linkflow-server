import axios from "axios";
import dns from "dns";
import { getSafeExternalUrl } from "../utils/url";
import { assertPublicHostname, createSafeLookup } from "../utils/safeFetch";

const REQUEST_TIMEOUT_MS = 6000;
const USER_AGENT = "Mozilla/5.0 (compatible; LinkFlowBot/1.0; +https://linkflow.app)";

const requestOnce = async (
  method: "head" | "get",
  url: string,
  safeAddresses: dns.LookupAddress[],
) => {
  const response = await axios.request({
    url,
    method,
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 0, // a redirect response still proves the server is alive; we don't need to follow it
    // GET only needs the status/headers, not the body — stream it and
    // destroy immediately below instead of capping maxContentLength, which
    // would otherwise reject (and falsely mark "broken") any page over the cap.
    responseType: method === "get" ? "stream" : undefined,
    // 2xx/3xx = reachable; anything else throws so the caller can retry/fall back.
    validateStatus: (status: number) => status < 400,
    lookup: createSafeLookup(safeAddresses),
    headers: { "User-Agent": USER_AGENT },
  } as any);

  if (method === "get") response.data.destroy();

  return response.status;
};

/**
 * Checks whether a saved link is still reachable. Reuses the same SSRF-safe
 * DNS-pinning as the metadata scraper. HEAD is tried first (cheap); some
 * servers reject HEAD entirely, so a GET with a tiny body cap is used as a
 * fallback before declaring the link broken — this avoids false positives.
 */
export const isLinkReachable = async (url: string): Promise<boolean> => {
  let parsedUrl;
  try {
    parsedUrl = getSafeExternalUrl(url);
  } catch {
    return false;
  }

  let safeAddresses;
  try {
    safeAddresses = await assertPublicHostname(parsedUrl.hostname);
  } catch {
    return false;
  }

  try {
    await requestOnce("head", parsedUrl.href, safeAddresses);
    return true;
  } catch {
    try {
      await requestOnce("get", parsedUrl.href, safeAddresses);
      return true;
    } catch {
      return false;
    }
  }
};
