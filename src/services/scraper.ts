import axios from "axios";
import * as cheerio from "cheerio";
import dns from "dns";
import { getSafeExternalUrl, isPrivateAddress, isSafeExternalUrl } from "../utils/url";

const dnsPromises = dns.promises;
const MAX_METADATA_BYTES = 1024 * 1024;

interface ScrapedMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  category: "Video" | "Article" | "Product" | "Social" | "Other";
}

const assertPublicHostname = async (hostname: string) => {
  const addresses = await dnsPromises.lookup(hostname, { all: true });

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Cannot access internal network addresses.");
  }

  return addresses;
};

const createSafeLookup = (allowedAddresses: dns.LookupAddress[]) => (
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

export const scrapeMetadata = async (url: string): Promise<ScrapedMetadata> => {
  try {
    const parsedUrl = getSafeExternalUrl(url);
    const hostname = parsedUrl.hostname;
    const safeAddresses = await assertPublicHostname(hostname);

    const { data } = await axios.get(parsedUrl.href, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      timeout: 5000,
      maxRedirects: 0,
      maxContentLength: MAX_METADATA_BYTES,
      maxBodyLength: MAX_METADATA_BYTES,
      lookup: createSafeLookup(safeAddresses),
    } as any);

    const $ = cheerio.load(data);

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
