import type { Post } from "./types";

export function blogPostingLd(post: Post, site: string): Record<string, unknown> {
  const url = `${site}/blog/${post.slug}`;
  const organisation = { "@type": "Organization", name: "ModelStill", url: site };
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    url,
    mainEntityOfPage: url,
    image: `${url}/opengraph-image`,
    keywords: post.tags.join(", "),
    author: organisation,
    publisher: organisation,
  };
}
