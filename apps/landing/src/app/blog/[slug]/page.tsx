import { ArrowLeftIcon, ArrowRightIcon, CaretLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogShell, JsonLd } from "@/components/blog/blog-shell";
import { PostMeta, TagList } from "@/components/blog/post-card";
import { PostThumb } from "@/components/blog/post-thumb";
import { PostToc } from "@/components/blog/post-toc";
import { RelatedPosts } from "@/components/blog/related-posts";
import { CtaButton } from "@/components/header";
import { POST_BODIES } from "@/lib/blog/bodies";
import { blogPostingLd } from "@/lib/blog/ld";
import { postBySlug, POSTS, type Post } from "@/lib/blog/posts";
import { relatedPosts } from "@/lib/blog/related";
import { tableOfContents } from "@/lib/blog/toc";
import { SITE_URL } from "@/lib/content";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const post = postBySlug((await params).slug);
  if (!post) return { title: "Post not found - ModelStill" };
  return {
    title: { absolute: post.title },
    description: post.description,
    keywords: post.tags,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: "article", title: post.title, description: post.description, url: `/blog/${post.slug}`, publishedTime: post.date, tags: post.tags },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

function Neighbour({ post, direction }: { post: Post | undefined; direction: "newer" | "older" }) {
  if (!post) return <div />;
  return (
    <a href={`/blog/${post.slug}`} className={`group rounded-[14px] border border-line bg-white p-5 transition-colors hover:border-[#cfccc4] ${direction === "older" ? "sm:text-right" : ""}`}>
      <span className={`flex items-center gap-1.5 text-[13px] text-muted ${direction === "older" ? "sm:justify-end" : ""}`}>
        {direction === "newer" ? <ArrowLeftIcon size={13} aria-hidden="true" /> : null}
        {direction === "newer" ? "Newer" : "Older"}
        {direction === "older" ? <ArrowRightIcon size={13} aria-hidden="true" /> : null}
      </span>
      <span className="mt-2 block text-[16px] leading-[23px] font-medium text-text">{post.title}</span>
    </a>
  );
}

export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
  const post = postBySlug((await params).slug);
  if (!post) notFound();
  const index = POSTS.findIndex((item) => item.slug === post.slug);
  const { items, body } = tableOfContents(POST_BODIES[post.slug]);
  return (
    <BlogShell>
      <JsonLd data={blogPostingLd(post, SITE_URL)} />
      <article>
        <header className="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
          <div>
            <a href="/blog" className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-accent">
              <CaretLeftIcon size={12} weight="bold" aria-hidden="true" />
              Blog
            </a>
            <h1 className="display mt-6 text-[36px] leading-[1.06] sm:text-[52px]">{post.title}</h1>
            <p className="mt-5 text-[18px] leading-[28px] text-muted">{post.description}</p>
            <div className="mt-6 flex flex-col gap-4">
              <PostMeta post={post} />
              <TagList tags={post.tags} />
            </div>
          </div>
          <PostThumb post={post} className="aspect-[16/10] rounded-[18px]" />
        </header>

        <div className="mt-14 grid gap-10 lg:mt-20 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <aside className="hidden lg:block">
            <div className="sticky top-[110px]">
              <PostToc items={items} />
            </div>
          </aside>
          <div className="min-w-0 max-w-[720px]">
            <div className="prose-post">{body}</div>
            <div className="mt-12 flex flex-col items-start gap-4 rounded-[18px] border border-line bg-[#f6f5f1] px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-serif text-[21px] leading-[1.25] tracking-[-0.02em] text-ink">See a release gate pass and fail in three commands.</p>
              <CtaButton arrow className="shrink-0" />
            </div>
            <RelatedPosts posts={relatedPosts(post, POSTS)} />
            <nav aria-label="More posts" className="mt-10 grid gap-3 sm:grid-cols-2">
              <Neighbour post={POSTS[index - 1]} direction="newer" />
              <Neighbour post={POSTS[index + 1]} direction="older" />
            </nav>
          </div>
        </div>
      </article>
    </BlogShell>
  );
}
