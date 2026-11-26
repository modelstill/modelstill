const SUFFIX = ".md";
const HOME = "index";

export function markdownPath(path: string): string {
  const page = path === "/" ? `/${HOME}` : path;
  return `/llms.mdx${page}${SUFFIX}`;
}

export function pageSlug(slug: string[] | undefined): string[] | null {
  const last = slug?.at(-1);
  if (!slug || !last?.endsWith(SUFFIX)) return null;
  const name = last.slice(0, -SUFFIX.length);
  const parents = slug.slice(0, -1);
  return parents.length === 0 && name === HOME ? [] : [...parents, name];
}

export function markdownParams(pages: { slug?: string[] }[]): { slug: string[] }[] {
  return pages.map(({ slug }) => {
    const parts = slug ?? [];
    if (parts.length === 0) return { slug: [`${HOME}${SUFFIX}`] };
    return { slug: [...parts.slice(0, -1), `${parts.at(-1)}${SUFFIX}`] };
  });
}
