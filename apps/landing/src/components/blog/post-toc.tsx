"use client";

import { useEffect, useState } from "react";
import type { TocItem } from "@/lib/blog/toc";

export function PostToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const headings = items.map((item) => document.getElementById(item.id)).filter((node): node is HTMLElement => node !== null);
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      () => {
        const line = window.innerHeight * 0.25;
        const passed = headings.filter((heading) => heading.getBoundingClientRect().top <= line);
        setActive((passed[passed.length - 1] ?? headings[0]!).id);
      },
      { rootMargin: "0px 0px -60% 0px", threshold: [0, 1] },
    );
    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 2) return null;
  return (
    <nav aria-label="Table of contents">
      <p className="text-[12px] font-medium tracking-[0.08em] text-muted uppercase">On this page</p>
      <ul className="mt-4 flex flex-col gap-3 border-l border-line">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={`-ml-px block border-l-2 pl-4 text-[14.5px] leading-[21px] transition-colors ${
                active === item.id ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"
              }`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
