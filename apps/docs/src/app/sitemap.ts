import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { DOCS_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: `${DOCS_URL}${page.url === "/" ? "" : page.url}`,
    changeFrequency: "weekly",
    priority: page.url === "/" ? 0.8 : 0.6,
  }));
}
