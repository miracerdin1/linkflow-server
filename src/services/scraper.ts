import axios from "axios";
import * as cheerio from "cheerio";
import { getSafeExternalUrl, isSafeExternalUrl } from "../utils/url";
import { assertPublicHostname, createSafeLookup } from "../utils/safeFetch";

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const OVERALL_TIMEOUT_MS = 5000;

interface ScrapedMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  category: "Video" | "Article" | "Product" | "Social" | "Other";
}

// Redirects are followed manually (not via axios's maxRedirects) so every
// hop gets the same SSRF validation (public-hostname check + pinned DNS
// lookup) as the original URL, instead of trusting wherever a 3xx points.
// All hops share one overall deadline (rather than a fresh timeout each),
// so a slow redirect chain can't block the caller far longer than a single
// request would have.
const fetchWithSafeRedirects = async (
  url: string,
  deadline: number = Date.now() + OVERALL_TIMEOUT_MS,
  redirectsLeft = MAX_REDIRECTS,
): Promise<{ data: unknown; finalUrl: URL }> => {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("Metadata fetch timed out.");

  const parsedUrl = getSafeExternalUrl(url);
  const safeAddresses = await assertPublicHostname(parsedUrl.hostname);

  const response = await axios.get(parsedUrl.href, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    },
    timeout: remainingMs,
    maxRedirects: 0,
    maxContentLength: MAX_METADATA_BYTES,
    maxBodyLength: MAX_METADATA_BYTES,
    lookup: createSafeLookup(safeAddresses),
    validateStatus: (status: number) => (status >= 200 && status < 300) || (status >= 300 && status < 400),
  } as any);

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.location;
    if (!location) throw new Error("Redirect response is missing a Location header.");
    if (redirectsLeft <= 0) throw new Error("Too many redirects.");

    const nextUrl = new URL(location, parsedUrl.href).href;
    return fetchWithSafeRedirects(nextUrl, deadline, redirectsLeft - 1);
  }

  return { data: response.data, finalUrl: parsedUrl };
};

export const scrapeMetadata = async (url: string): Promise<ScrapedMetadata> => {
  try {
    const { data, finalUrl: parsedUrl } = await fetchWithSafeRedirects(url);

    const $ = cheerio.load(data as any);

    const resolveUrl = (relativeUrl?: string) => {
      if (!relativeUrl) return undefined;

      try {
        const resolvedUrl = new URL(relativeUrl, parsedUrl.href).href;

        if (!isSafeExternalUrl(resolvedUrl)) return undefined;

        return resolvedUrl;
      } catch (error) {
        return undefined;
      }
    };

    const title =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      $("title").text();

    const description =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="twitter:description"]').attr("content") ||
      $('meta[name="description"]').attr("content");

    let imageUrl =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('link[rel="image_src"]').attr("href");

    if (!imageUrl) {
      imageUrl =
        $('link[rel="apple-touch-icon"]').attr("href") ||
        $('link[rel="icon"]').attr("href") ||
        $('link[rel="shortcut icon"]').attr("href");
    }

    imageUrl = resolveUrl(imageUrl);
    const siteName = $('meta[property="og:site_name"]').attr("content");
    let category: ScrapedMetadata["category"] = "Other";
    const domain = parsedUrl.hostname.toLowerCase();

    if (domain.includes("youtube") || domain.includes("vimeo") || domain.includes("tiktok")) {
      category = "Video";
    } else if (domain.includes("medium") || domain.includes("dev.to") || domain.includes("blog")) {
      category = "Article";
    } else if (domain.includes("amazon") || domain.includes("trendyol") || domain.includes("hepsiburada")) {
      category = "Product";
    } else if (domain.includes("twitter") || domain.includes("x.com") || domain.includes("instagram") || domain.includes("linkedin")) {
      category = "Social";
    }

    console.log(`[Scraper] URL: ${parsedUrl.href} | Domain: ${domain} | Category: ${category}`);

    return {
      title: title?.trim(),
      description: description?.trim(),
      imageUrl,
      siteName,
      category,
    };
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return {
      category: "Other",
    };
  }
};
