import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { pageHref, pageWindow } from "@/lib/blog/pagination";

const EDGE = "inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-[14px] font-medium text-text transition-colors hover:border-accent hover:text-accent";
const NUMBER = "inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-line bg-white px-2 text-[14px] text-text transition-colors hover:border-accent hover:text-accent";
const CURRENT = "inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-ink px-2 text-[14px] text-white";

export function BlogPagination({ current, total }: { current: number; total: number }) {
  if (total <= 1) return null;
  return (
    <nav aria-label="Blog pagination" className="mt-16 flex flex-col items-center gap-5">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex-1">
          {current > 1 ? (
            <a href={pageHref(current - 1)} rel="prev" className={EDGE}>
              <ArrowLeftIcon size={15} aria-hidden="true" />
              Newer
            </a>
          ) : null}
        </div>
        <p className="text-[13px] tracking-[0.08em] text-muted uppercase">
          Page {current} of {total}
        </p>
        <div className="flex flex-1 justify-end">
          {current < total ? (
            <a href={pageHref(current + 1)} rel="next" className={EDGE}>
              Older
              <ArrowRightIcon size={15} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
      <ol className="flex flex-wrap items-center justify-center gap-1.5">
        {pageWindow(current, total).map((item, index) =>
          item === "gap" ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted">
              &hellip;
            </li>
          ) : (
            <li key={item}>
              {item === current ? (
                <span aria-current="page" className={CURRENT}>
                  {item}
                </span>
              ) : (
                <a href={pageHref(item)} aria-label={`Page ${item}`} className={NUMBER}>
                  {item}
                </a>
              )}
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
