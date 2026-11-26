import { postsForPage, POSTS, totalBlogPages } from "@/lib/blog/posts";
import { SITE_URL } from "@/lib/content";
import { pageHref } from "@/lib/blog/pagination";
import { BlogPagination } from "./blog-pagination";
import { BlogShell } from "./blog-shell";
import { FeaturedPost, PostCard } from "./post-card";

export function BlogIndex({ page }: { page: number }) {
  const total = totalBlogPages();
  const posts = postsForPage(page);
  const [featured, ...rest] = page === 1 ? posts : [undefined, ...posts];
  return (
    <BlogShell>
      {page > 1 ? <link rel="prev" href={`${SITE_URL}${pageHref(page - 1)}`} /> : null}
      {page < total ? <link rel="next" href={`${SITE_URL}${pageHref(page + 1)}`} /> : null}
      <header className="max-w-[720px]">
        <p className="text-[14px] text-muted">{page === 1 ? "Blog" : `Blog · Page ${page}`}</p>
        <h1 className="display mt-3 text-[44px] leading-[1.04] sm:text-[60px]">
          Notes on shipping <em className="italic">dependable</em> AI
        </h1>
      </header>
      {featured ? (
        <div className="mt-12 sm:mt-16">
          <FeaturedPost post={featured} />
        </div>
      ) : null}
      <div className="mt-16 grid grid-cols-1 gap-x-8 gap-y-14 border-t border-line pt-14 md:grid-cols-2 lg:grid-cols-3">
        {rest.map((post) => (post ? <PostCard key={post.slug} post={post} /> : null))}
      </div>
      <BlogPagination current={page} total={total} />
      <p className="mt-12 text-center text-[15px] text-muted">
        Looking for something specific?{" "}
        <a href="/blog/all" className="font-medium text-accent hover:text-[#e06f08]">
          Browse all {POSTS.length} posts by topic
        </a>
      </p>
    </BlogShell>
  );
}
