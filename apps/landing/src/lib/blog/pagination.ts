export type PageWindowItem = number | "gap";

const AROUND_CURRENT = 2;

export function pageCount(items: number, size: number): number {
  return Math.max(1, Math.ceil(items / size));
}

export function pagePosts<T>(items: readonly T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}

export function pageHref(page: number): string {
  return page === 1 ? "/blog" : `/blog/page/${page}`;
}

export function pageWindow(current: number, total: number): PageWindowItem[] {
  const wanted = new Set<number>([1, total]);
  for (let page = current - AROUND_CURRENT; page <= current + AROUND_CURRENT; page++) {
    if (page >= 1 && page <= total) wanted.add(page);
  }
  const out: PageWindowItem[] = [];
  let previous = 0;
  for (const page of [...wanted].sort((a, b) => a - b)) {
    if (page - previous === 2) out.push(page - 1);
    else if (page - previous > 2) out.push("gap");
    out.push(page);
    previous = page;
  }
  return out;
}
