import type { Metadata } from "next";
import { BlogIndex } from "@/components/blog/blog-index";

const DESCRIPTION = "Notes on LLM evals, golden datasets, judges and release gates, and what the numbers said when we measured real tasks.";

export const metadata: Metadata = {
  title: "Blog - ModelStill",
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  openGraph: { title: "ModelStill blog", description: DESCRIPTION, url: "/blog" },
};

export default function BlogPage() {
  return <BlogIndex page={1} />;
}
