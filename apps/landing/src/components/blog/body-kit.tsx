import { ArrowUpRightIcon, InfoIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { DOCS_URL } from "@/lib/content";

export function Docs({ doc, children }: { doc: string; children: ReactNode }) {
  return <a href={`${DOCS_URL}${doc}`}>{children}</a>;
}

export function Post({ slug, children }: { slug: string; children: ReactNode }) {
  return <a href={`/blog/${slug}`}>{children}</a>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="inline-code">{children}</code>;
}

export function CodeBlock({ title, children }: { title?: string; children: string }) {
  return (
    <figure className="code-block">
      {title ? <figcaption>{title}</figcaption> : null}
      <pre>
        <code>{children.replace(/^\n/, "").replace(/\n$/, "")}</code>
      </pre>
    </figure>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="post-table">
      <table>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <aside className="post-note">
      <InfoIcon size={18} weight="bold" aria-hidden="true" className="mt-[3px] shrink-0 text-leaf" />
      <div>{children}</div>
    </aside>
  );
}

export function DocsCard({ doc, title, children }: { doc: string; title: string; children: ReactNode }) {
  return (
    <a href={`${DOCS_URL}${doc}`} className="docs-card group">
      <span className="flex items-center justify-between gap-3 font-medium text-text">
        {title}
        <ArrowUpRightIcon size={16} aria-hidden="true" className="shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" />
      </span>
      <span className="mt-1 block text-muted">{children}</span>
    </a>
  );
}

type IntervalRow = { label: string; value: number; low: number; high: number; tone: "base" | "candidate" };

function fixed(value: number): string {
  return value.toFixed(3).replace("-", "\u2212");
}

export function IntervalChart({ rows, min, max, reference, caption }: { rows: IntervalRow[]; min: number; max: number; reference?: number; caption: string }) {
  const at = (value: number) => `${((value - min) / (max - min)) * 100}%`;
  return (
    <figure className="interval-chart">
      <div role="img" aria-label={caption}>
        {rows.map((row) => {
          const colour = row.tone === "base" ? "#1f2a14" : "#f47c0e";
          return (
            <div key={row.label} className="interval-row">
              <div className="flex flex-wrap justify-between gap-x-4 text-[14.5px] leading-[20px]">
                <span className="text-text">{row.label}</span>
                <span className="text-muted tabular-nums">{`${fixed(row.value)} [${fixed(row.low)}, ${fixed(row.high)}]`}</span>
              </div>
              <div className="relative mt-2 h-4">
                {reference === undefined ? null : <span className="absolute inset-y-[-6px] w-0 border-l border-dashed border-[#9a9790]" style={{ left: at(reference) }} />}
                <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full opacity-45" style={{ left: at(row.low), width: `calc(${at(row.high)} - ${at(row.low)})`, background: colour }} />
                <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: at(row.value), background: colour }} />
              </div>
            </div>
          );
        })}
        <div className="relative mt-3 h-4 text-[12.5px] text-muted tabular-nums">
          <span className="absolute left-0">{fixed(min)}</span>
          <span className="absolute -translate-x-1/2" style={{ left: "50%" }}>
            {fixed((min + max) / 2)}
          </span>
          <span className="absolute right-0">{fixed(max)}</span>
        </div>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
