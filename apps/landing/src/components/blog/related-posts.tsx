import { formatDate, type Post } from "@/lib/blog/posts";

export function RelatedPosts({ posts }: { posts: readonly Post[] }) {
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="related-heading" className="mt-16 border-t border-line pt-10">
      <h2 id="related-heading" className="display text-[30px] leading-none">
        Keep reading
      </h2>
      <ul className="mt-6 flex flex-col gap-3">
        {posts.map((post) => (
          <li key={post.slug}>
            <a href={`/blog/${post.slug}`} className="group block rounded-[14px] border border-line bg-white px-5 py-4 transition-colors hover:border-[#cfccc4]">
              <span className="text-[13px] text-muted">
                {post.tags[0]} &middot; {formatDate(post.date)}
              </span>
              <span className="mt-1 block text-[17px] leading-[25px] font-medium text-text group-hover:text-ink">{post.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
