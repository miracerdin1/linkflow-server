import axios from "axios";
import * as cheerio from "cheerio";
import dns from "dns";
import { promisify } from "util";
import http from "http";
import https from "https";

const lookupAsync = promisify(dns.lookup);

interface ScrapedMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  category: "Video" | "Article" | "Product" | "Social" | "Other";
}

// Check if an IP address is private/internal
const isPrivateIP = (ip: string) => {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127 ||
    ip === "169.254.169.254" || // AWS / Cloud metadata
    ip === "0.0.0.0"
  );
};

// Custom DNS lookup function for HTTP agents to block internal IPs even during redirects
const safeLookup = (
  hostname: string,
  options: dns.LookupOneOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
) => {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err, "", 0);
    if (isPrivateIP(address)) {
      return callback(new Error("SSRF Attempt blocked: Cannot access internal networks."), "", 0);
    }
    callback(null, address, family);
  });
};

const httpAgent = new http.Agent({ lookup: safeLookup as any });
const httpsAgent = new https.Agent({ lookup: safeLookup as any });

export const scrapeMetadata = async (url: string): Promise<ScrapedMetadata> => {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      timeout: 5000, // Safety timeout
      maxContentLength: 5 * 1024 * 1024, // 5MB limit to prevent DoS (OOM)
      httpAgent,
      httpsAgent,
    });

    const $ = cheerio.load(data);

    // Helper to resolve relative URLs
    const resolveUrl = (relativeUrl?: string) => {
      if (!relativeUrl) return undefined;
      try {
        return new URL(relativeUrl, url).href;
      } catch (e) {
        return relativeUrl;
      }
    };

    // Extract Title (OG > Twitter > Title Tag)
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="twitter:title"]').attr("content") ||
      $("title").text();

    // Extract Description (OG > Twitter > Meta Description)
    const description =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="twitter:description"]').attr("content") ||
      $('meta[name="description"]').attr("content");

    // Extract Image (OG > Twitter > Link Image > Favicon)
    let imageUrl =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('link[rel="image_src"]').attr("href");

    // Fallback to Favicon if no image found
    if (!imageUrl) {
      const favicon =
        $('link[rel="apple-touch-icon"]').attr("href") ||
        $('link[rel="icon"]').attr("href") ||
        $('link[rel="shortcut icon"]').attr("href");

      if (favicon) {
        imageUrl = favicon;
      }
    }

    // Resolve relative URL for image
    imageUrl = resolveUrl(imageUrl);

    const siteName = $('meta[property="og:site_name"]').attr("content");

    // Auto-Categorization Logic
    let category: ScrapedMetadata["category"] = "Other";
    const domain = parsedUrl.hostname.toLowerCase();

    if (
      domain.includes("youtube") ||
      domain.includes("vimeo") ||
      domain.includes("tiktok")
    ) {
      category = "Video";
    } else if (
      domain.includes("medium") ||
      domain.includes("dev.to") ||
      domain.includes("blog")
    ) {
      category = "Article";
    } else if (
      domain.includes("amazon") ||
      domain.includes("trendyol") ||
      domain.includes("hepsiburada")
    ) {
      category = "Product";
    } else if (
      domain.includes("twitter") ||
      domain.includes("x.com") ||
      domain.includes("instagram") ||
      domain.includes("linkedin")
    ) {
      category = "Social";
    }

    console.log(
      `[Scraper] URL: ${url} | Domain: ${domain} | Category: ${category}`,
    );

    return {
      title: title?.trim(),
      description: description?.trim(),
      imageUrl,
      siteName,
      category,
    };
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    // Fallback if scraping fails
    return {
      category: "Other",
    };
  }
};
