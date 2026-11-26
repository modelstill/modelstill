import type { MetadataRoute } from "next";
import { pageHref } from "@/lib/blog/pagination";
import { POSTS, totalBlogPages } from "@/lib/blog/posts";
import { SITE_URL } from "@/lib/content";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const newest = POSTS[0]?.date;
  const pages = Array.from({ length: totalBlogPages() - 1 }, (_, index) => ({ url: `${SITE_URL}${pageHref(index + 2)}`, lastModified: newest }));
  return [
    { url: `${SITE_URL}/`, lastModified: newest },
    { url: `${SITE_URL}/blog`, lastModified: newest },
    { url: `${SITE_URL}/blog/all`, lastModified: newest },
    ...pages,
    ...POSTS.map((post) => ({ url: `${SITE_URL}/blog/${post.slug}`, lastModified: post.date })),
  ];
}
