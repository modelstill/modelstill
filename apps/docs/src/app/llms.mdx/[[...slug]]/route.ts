import { notFound } from "next/navigation";
import { markdownParams, pageSlug } from "@/lib/markdown-path";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export async function GET(_request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const wanted = pageSlug(slug);
  const page = wanted ? source.getPage(wanted) : undefined;
  if (!page) notFound();
  const body = await page.data.getText("processed");
  const text = `# ${page.data.title}\n\n${page.data.description ? `${page.data.description}\n\n` : ""}${body}`;
  return new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}

export function generateStaticParams() {
  return markdownParams(source.generateParams());
}
