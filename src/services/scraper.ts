import axios from "axios";
import * as cheerio from "cheerio";
import type { ScrapedMetadata } from "../types/scraper";
import { getSafeExternalUrl, isSafeExternalUrl } from "../utils/url";
import { assertPublicHostname, createSafeLookup } from "../utils/safeFetch";

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const OVERALL_TIMEOUT_MS = 5000;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

// Instagram/Facebook/Threads only render their Open Graph tags for Meta's
// own crawler UA (used for link-preview generation on their own platforms);
// a regular browser UA gets served an empty client-rendered shell with no
// usable metadata at all, which is why those links previously came back
// with a generic "Instagram" title and no image.
const META_CRAWLER_USER_AGENT = "facebookexternalhit/1.1";
const META_CRAWLER_HOSTNAMES = ["instagram.com", "facebook.com", "fb.com", "threads.net"];

const isMetaCrawlerHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return META_CRAWLER_HOSTNAMES.some((domain) => host === domain || host.endsWith(`.${domain}`));
};

const getUserAgentFor = (hostname: string): string =>
  isMetaCrawlerHost(hostname) ? META_CRAWLER_USER_AGENT : DEFAULT_USER_AGENT;

class MetadataFetchError extends Error {
  constructor(
    message: string,
    readonly externalUrl: URL,
  ) {
    super(message);
    this.name = "MetadataFetchError";
  }
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
  const parsedUrl = getSafeExternalUrl(url);
  try {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("Metadata fetch timed out.");

    const safeAddresses = await assertPublicHostname(parsedUrl.hostname);
    const response = await axios.get(parsedUrl.href, {
      headers: {
        "User-Agent": getUserAgentFor(parsedUrl.hostname),
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
  } catch (error) {
    if (error instanceof MetadataFetchError) throw error;

    const message = error instanceof Error ? error.message : "Metadata fetch failed.";
    throw new MetadataFetchError(message, parsedUrl);
  }
};

const VIDEO_DOMAINS = ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "dailymotion.com", "twitch.tv"];
const SOCIAL_DOMAINS = [
  "twitter.com",
  "x.com",
  "instagram.com",
  "linkedin.com",
  "facebook.com",
  "fb.com",
  "threads.net",
  "reddit.com",
  "pinterest.com",
];
const PRODUCT_DOMAINS = [
  "amazon.com",
  "amazon.com.tr",
  "amzn.to",
  "amzn.eu",
  "trendyol.com",
  "ty.gl",
  "hepsiburada.com",
  "app.hb.biz",
  "n11.com",
  "ciceksepeti.com",
  "aliexpress.com",
  "ebay.com",
  "etsy.com",
  "myshopify.com",
  "zara.com",
  "mango.com",
  "boyner.com.tr",
  "defacto.com.tr",
  "lcwaikiki.com",
  "koton.com",
  "teknosa.com",
  "vatanbilgisayar.com",
  "mediamarkt.com.tr",
  "morhipo.com",
];
const ARTICLE_DOMAINS = ["medium.com", "dev.to", "blogspot.com", "substack.com", "hashnode.com"];

const SITE_NAMES = new Map<string, string>([
  ["instagram.com", "Instagram"],
  ["trendyol.com", "Trendyol"],
  ["ty.gl", "Trendyol"],
  ["hepsiburada.com", "Hepsiburada"],
  ["app.hb.biz", "Hepsiburada"],
  ["n11.com", "n11"],
  ["ciceksepeti.com", "ÇiçekSepeti"],
  ["amazon.com.tr", "Amazon"],
  ["amazon.com", "Amazon"],
  ["amzn.to", "Amazon"],
  ["amzn.eu", "Amazon"],
]);

const SHORT_PRODUCT_DOMAINS = new Set(["ty.gl", "app.hb.biz", "amzn.to", "amzn.eu"]);
const MAX_TITLE_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 2000;

const matchesDomain = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

const matchesAnyDomain = (hostname: string, domains: string[]): boolean =>
  domains.some((domain) => matchesDomain(hostname, domain));

const classifyDomain = (hostname: string): ScrapedMetadata["category"] | undefined => {
  const domain = hostname.toLowerCase();
  if (matchesAnyDomain(domain, VIDEO_DOMAINS)) return "Video";
  if (matchesAnyDomain(domain, SOCIAL_DOMAINS)) return "Social";
  if (matchesAnyDomain(domain, PRODUCT_DOMAINS)) return "Product";
  if (matchesAnyDomain(domain, ARTICLE_DOMAINS)) return "Article";
  return undefined;
};

const getKnownSiteName = (hostname: string): string | undefined => {
  const domain = hostname.toLowerCase();
  return [...SITE_NAMES].find(([knownDomain]) => matchesDomain(domain, knownDomain))?.[1];
};

const normalizeMetadataText = (value: string | undefined, maxLength: number): string | undefined => {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  return normalized.slice(0, maxLength);
};

const BLOCKED_PAGE_MARKERS = [
  "access denied",
  "attention required",
  "forbidden",
  "just a moment",
  "robot check",
];

const isBlockedPageText = (value?: string): boolean => {
  const normalized = value?.toLowerCase();
  if (!normalized) return false;

  return BLOCKED_PAGE_MARKERS.some((marker) => normalized.includes(marker));
};

// Some bot-protected sites (e.g. Trendyol, behind Cloudflare Bot Management)
// reject the request outright at the TLS/fingerprint level before any HTML
// ever comes back, so there are no OG tags to read. In that case we still
// have the URL itself: most product/listing URLs encode the item name in
// the path (brand/slug-p-12345), so we can synthesize a readable title
// instead of leaving the link with no title at all.
const deriveFallbackTitle = (parsedUrl: URL): string | undefined => {
  const segments = parsedUrl.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  if (segments.length === 0) return undefined;

  const words = segments
    .join(" ")
    .replace(/-p-\d+\b/gi, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!words || /^\d+$/.test(words)) return undefined;

  return normalizeMetadataText(words.replace(/\b\w/g, (char) => char.toUpperCase()), MAX_TITLE_LENGTH);
};

// Instagram serves real Open Graph data for profile pages (via the Meta
// crawler UA), but individual posts/reels are login-walled even for that
// UA: no caption, no real photo, nothing — just a bare "Instagram" title
// and the app's generic icon. Rather than show that generic icon as if it
// were the post's actual image, describe what kind of link it is from the
// URL shape itself, which is the only reliable signal left in that case.
const isInstagramHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return host === "instagram.com" || host.endsWith(".instagram.com");
};

const describeInstagramPath = (pathname: string): string | undefined => {
  const segments = pathname.split("/").filter(Boolean);
  const contentType = segments[0] === "share" ? segments[1] : segments[0];
  switch (contentType) {
    case "p":
      return "Instagram Gönderisi";
    case "reel":
    case "reels":
      return "Instagram Reel";
    case "tv":
      return "Instagram Video (IGTV)";
    case "stories":
      return "Instagram Hikayesi";
    default:
      if (segments.length !== 1) return undefined;
      return `@${segments[0]} · Instagram`;
  }
};

const getFallbackMetadata = (
  parsedUrl: URL,
  category = classifyDomain(parsedUrl.hostname) ?? "Other",
): ScrapedMetadata => {
  const domain = parsedUrl.hostname.toLowerCase();
  const siteName = getKnownSiteName(domain);

  if (isInstagramHost(domain)) {
    const title = describeInstagramPath(parsedUrl.pathname) ?? "Instagram İçeriği";
    return {
      title,
      description: "Instagram'da paylaşılan içerik.",
      siteName: "Instagram",
      category: "Social",
    };
  }

  if (category === "Product") {
    const title = SHORT_PRODUCT_DOMAINS.has(domain)
      ? `${siteName ?? "Alışveriş Sitesi"} Ürün Bağlantısı`
      : deriveFallbackTitle(parsedUrl) ?? `${siteName ?? "Alışveriş Sitesi"} Ürünü`;

    return {
      title,
      description: `${siteName ?? "Alışveriş sitesi"} ürün bağlantısı.`,
      siteName,
      category,
    };
  }

  return {
    title: deriveFallbackTitle(parsedUrl),
    siteName,
    category,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectJsonLdNodes = (
  value: unknown,
  nodes: Record<string, unknown>[],
  depth = 0,
): void => {
  if (depth > 6 || nodes.length >= 1000) return;

  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdNodes(item, nodes, depth + 1));
    return;
  }

  if (!isRecord(value)) return;

  nodes.push(value);
  Object.values(value).forEach((item) => collectJsonLdNodes(item, nodes, depth + 1));
};

const hasJsonLdType = (node: Record<string, unknown>, expectedType: string): boolean => {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => typeof item === "string" && item.toLowerCase() === expectedType);
};

const getStringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const getImageValue = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(getImageValue).find(Boolean);
  if (!isRecord(value)) return undefined;

  return getStringValue(value.url) ?? getStringValue(value.contentUrl);
};

const extractProductMetadata = ($: cheerio.CheerioAPI): Partial<ScrapedMetadata> | undefined => {
  let productMetadata: Partial<ScrapedMetadata> | undefined;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (productMetadata) return;

    try {
      const nodes: Record<string, unknown>[] = [];
      collectJsonLdNodes(JSON.parse($(element).text()), nodes);
      const product = nodes.find((node) => hasJsonLdType(node, "product"));
      if (!product) return;

      const brand = isRecord(product.brand) ? getStringValue(product.brand.name) : undefined;
      productMetadata = {
        title: getStringValue(product.name),
        description: getStringValue(product.description),
        imageUrl: getImageValue(product.image),
        siteName: brand,
      };
    } catch {
      // Malformed JSON-LD is ignored; other metadata sources can still be used.
    }
  });

  return productMetadata;
};

// Fallback for domains that aren't in the hardcoded lists above: a lot of
// sites (especially e-commerce ones) can't be recognized by domain alone,
// but they do describe themselves via standard OG/Twitter-card/JSON-LD
// markup that we can read straight off the page we already fetched.
const detectCategoryFromContent = (
  $: cheerio.CheerioAPI,
  productMetadata?: Partial<ScrapedMetadata>,
): ScrapedMetadata["category"] | undefined => {
  const ogType = $('meta[property="og:type"]').attr("content")?.toLowerCase().trim();
  const twitterCard = $('meta[name="twitter:card"]').attr("content")?.toLowerCase().trim();

  const hasProductPriceMeta =
    $('meta[property="product:price:amount"]').attr("content") ||
    $('meta[property="og:price:amount"]').attr("content");

  if (ogType?.startsWith("video") || ogType === "music") return "Video";
  if (ogType?.startsWith("product") || twitterCard === "product" || hasProductPriceMeta || productMetadata) {
    return "Product";
  }
  if (ogType === "article" || ogType === "book") return "Article";
  if (ogType === "profile") return "Social";

  return undefined;
};

export const scrapeMetadata = async (url: string): Promise<ScrapedMetadata> => {
  try {
    const { data, finalUrl: parsedUrl } = await fetchWithSafeRedirects(url);

    const $ = cheerio.load(data as any);
    const productMetadata = extractProductMetadata($);

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

    const domain = parsedUrl.hostname.toLowerCase();
    const isSocialPlatform = matchesAnyDomain(domain, SOCIAL_DOMAINS);

    const title =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      productMetadata?.title ||
      $("title").text();

    const description =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="twitter:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      productMetadata?.description;

    let imageUrl =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('link[rel="image_src"]').attr("href") ||
      productMetadata?.imageUrl;

    // A site favicon/app icon is a reasonable stand-in image for a generic
    // website, but for a social platform it's never the post's actual
    // content — showing it would misrepresent the link, so skip it there.
    if (!imageUrl && !isSocialPlatform) {
      imageUrl =
        $('link[rel="apple-touch-icon"]').attr("href") ||
        $('link[rel="icon"]').attr("href") ||
        $('link[rel="shortcut icon"]').attr("href");
    }

    imageUrl = resolveUrl(imageUrl);
    const category = classifyDomain(domain) ?? detectCategoryFromContent($, productMetadata) ?? "Other";
    const fallback = getFallbackMetadata(parsedUrl, category);
    const siteName =
      normalizeMetadataText($('meta[property="og:site_name"]').attr("content"), MAX_TITLE_LENGTH) ??
      fallback.siteName;

    const normalizedTitle = normalizeMetadataText(title, MAX_TITLE_LENGTH);
    const isGenericProductTitle =
      category === "Product" &&
      normalizedTitle?.toLocaleLowerCase("tr-TR") === siteName?.toLocaleLowerCase("tr-TR");
    let resolvedTitle =
      !isBlockedPageText(normalizedTitle) && !isGenericProductTitle ? normalizedTitle ?? fallback.title : fallback.title;

    const normalizedDescription = normalizeMetadataText(description, MAX_DESCRIPTION_LENGTH);
    const resolvedDescription = !isBlockedPageText(normalizedDescription)
      ? normalizedDescription ?? fallback.description
      : fallback.description;

    if (isInstagramHost(domain) && (!title || title.trim().toLowerCase() === "instagram")) {
      resolvedTitle = fallback.title;
    }

    console.log(`[Scraper] Domain: ${domain} | Category: ${category}`);

    return {
      title: resolvedTitle,
      description: resolvedDescription,
      imageUrl,
      siteName,
      category,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Metadata scraping failed:", message);

    // The fetch itself failed (often a bot-protected site rejecting the
    // request before serving any HTML), but the URL alone still tells us
    // the site and, usually, a readable title — better than an empty
    // "Other" link with no information at all.
    try {
      const parsedUrl = error instanceof MetadataFetchError ? error.externalUrl : getSafeExternalUrl(url);
      return getFallbackMetadata(parsedUrl);
    } catch {
      return { category: "Other" };
    }
  }
};
