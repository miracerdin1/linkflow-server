export type LinkCategory = "Video" | "Article" | "Product" | "Social" | "Other";

export interface ScrapedMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  category: LinkCategory;
}
