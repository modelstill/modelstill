import { ArrowUpRightIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { postMinutes } from "@/lib/blog/minutes";
import { formatDate, type Post } from "@/lib/blog/posts";
import { PostThumb } from "./post-thumb";

export function PostMeta({ post }: { post: Post }) {
  return (
    <p className="text-[14px] text-muted">
      <time dateTime={post.date}>{formatDate(post.date)}</time> <span aria-hidden="true">&middot;</span> {postMinutes(post.slug)} min read
    </p>
  );
}

export function TagList({ tags }: { tags: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li key={tag} className="rounded-full border border-line bg-white px-2.5 py-1 text-[12.5px] leading-none text-text">
          {tag}
        </li>
      ))}
    </ul>
  );
}

export function PostCard({ post }: { post: Post }) {
  return (
    <a href={`/blog/${post.slug}`} className="group flex flex-col">
      <PostThumb post={post} className="aspect-[16/10] rounded-[14px]" />
      <div className="mt-5 flex items-start justify-between gap-4">
        <h3 className="font-serif text-[22px] leading-[1.2] tracking-[-0.02em] text-ink">{post.title}</h3>
        <ArrowUpRightIcon size={18} aria-hidden="true" className="mt-1 shrink-0 text-ink motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" />
      </div>
      <p className="mt-3 line-clamp-3 text-[15.5px] leading-[24px] text-muted">{post.description}</p>
      <div className="mt-4">
        <PostMeta post={post} />
      </div>
    </a>
  );
}

export function FeaturedPost({ post }: { post: Post }) {
  return (
    <section className="grid items-center gap-8 md:grid-cols-[1fr_1.05fr] md:gap-12">
      <div>
        <TagList tags={post.tags} />
        <h2 className="display mt-5 text-[34px] leading-[1.08] sm:text-[46px]">
          <a href={`/blog/${post.slug}`} className="hover:text-[#3b4a2a]">
            {post.title}
          </a>
        </h2>
        <p className="mt-5 text-[17px] leading-[27px] text-muted">{post.description}</p>
        <div className="mt-5">
          <PostMeta post={post} />
        </div>
        <a href={`/blog/${post.slug}`} className="mt-6 inline-flex items-center gap-1 text-[15.5px] font-medium text-accent hover:text-[#e06f08]">
          Read the post
          <CaretRightIcon size={14} weight="bold" aria-hidden="true" />
        </a>
      </div>
      <a href={`/blog/${post.slug}`} tabIndex={-1} aria-hidden="true">
        <PostThumb post={post} className="aspect-[16/10] rounded-[18px]" />
      </a>
    </section>
  );
}
