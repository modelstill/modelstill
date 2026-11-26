import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { AllPostsList } from "@/components/blog/all-posts-list";
import { BlogShell } from "@/components/blog/blog-shell";
import { POSTS } from "@/lib/blog/posts";

const DESCRIPTION = "Every ModelStill blog post on one page, grouped by topic: evaluation, datasets, judges and case studies.";

export const metadata: Metadata = {
  title: "All posts - ModelStill blog",
  description: DESCRIPTION,
  alternates: { canonical: "/blog/all" },
  openGraph: { title: "All posts - ModelStill blog", description: DESCRIPTION, url: "/blog/all" },
};

export default function AllPostsPage() {
  return (
    <BlogShell>
      <a href="/blog" className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-accent">
        <ArrowLeftIcon size={13} aria-hidden="true" />
        Latest posts
      </a>
      <h1 className="display mt-6 text-[44px] leading-[1.04] sm:text-[60px]">All posts</h1>
      <p className="mt-4 max-w-[620px] text-[17px] leading-[27px] text-muted">{DESCRIPTION}</p>
      <div className="mt-10 max-w-[860px]">
        <AllPostsList posts={POSTS} />
      </div>
    </BlogShell>
  );
}
