import { POSTS } from "@/lib/blog/posts";
import { DOCS_URL, SITE_URL } from "@/lib/content";

export const dynamic = "force-static";

export function GET(): Response {
  const rows = POSTS.map((post) => `- [${post.title}](${SITE_URL}/blog/${post.slug}) (${post.date}) - ${post.description}`).join("\n");
  const body = `# ModelStill blog

> Every post, newest first, ${POSTS.length} in total. Notes on LLM evals, golden datasets, judges and release gates, and what ModelStill measured on real tasks.

## Posts
${rows}

## Related
- [Docs](${DOCS_URL}): quickstart, guides and reference.
- [All posts by topic](${SITE_URL}/blog/all)
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
