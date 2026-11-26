import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogIndex } from "@/components/blog/blog-index";
import { totalBlogPages } from "@/lib/blog/posts";

type Params = { page: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return Array.from({ length: totalBlogPages() }, (_, index) => ({ page: String(index + 1) }));
}

function parsePage(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 1 && page <= totalBlogPages() ? page : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const page = parsePage((await params).page);
  if (page === null) return { title: "Page not found - ModelStill" };
  if (page === 1) return { title: "Blog - ModelStill", alternates: { canonical: "/blog" }, robots: { index: false, follow: true } };
  return {
    title: `Blog, page ${page} - ModelStill`,
    description: `Older posts from the ModelStill blog. Page ${page} of ${totalBlogPages()}.`,
    alternates: { canonical: `/blog/page/${page}` },
  };
}

export default async function BlogPageN({ params }: { params: Promise<Params> }) {
  const page = parsePage((await params).page);
  if (page === null) notFound();
  return <BlogIndex page={page} />;
}
