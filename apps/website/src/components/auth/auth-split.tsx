import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark, PRODUCT_NAME } from "@modelstill/ui/blocks/brand";
import { DOCS_URL } from "@/lib/links";
import { DistilScene } from "./distil-scene";
import { SceneGradient } from "./scene-gradient";

export function SceneAside({ headline, footnote, children }: { headline: ReactNode; footnote?: ReactNode; children: ReactNode }) {
  return (
    <aside className="relative hidden overflow-hidden rounded-lg lg:block">
      <div data-slot="scene" className="auth-aside-in absolute inset-0 flex flex-col overflow-hidden rounded-lg bg-sidebar px-10 pt-12 pb-10 xl:px-14 xl:pt-14">
        <div className="max-w-[560px]">
          <h2 className="scene-headline text-foreground">{headline}</h2>
          {footnote && <p className="auth-cap-in mt-4 text-[14px] leading-5 text-muted-foreground">{footnote}</p>}
        </div>
        <div className="relative mt-10 min-h-[340px] flex-1">
          <div className="absolute inset-0 overflow-hidden rounded-2xl ring-1 ring-border/70">
            <SceneGradient />
          </div>
          <div className="relative z-10 flex h-full items-center justify-center px-8 py-10">{children}</div>
        </div>
      </div>
    </aside>
  );
}

export function BrandHome() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 text-foreground">
      <LogoMark size={28} />
      <span className="brand-wordmark text-[22px] leading-none">{PRODUCT_NAME}</span>
    </Link>
  );
}

export function AuthSplit({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-cols-1 bg-sidebar text-foreground lg:grid-cols-[minmax(520px,44%)_1fr] lg:gap-2 lg:p-2">
      <div className="flex flex-col bg-background px-6 py-8 sm:px-10 lg:rounded-lg lg:border lg:border-border lg:px-14 lg:shadow-xs">
        <header>
          <BrandHome />
        </header>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[400px]">
            <h1 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.01em] text-foreground">{title}</h1>
            <p className="mt-2 text-[14px] leading-5 text-muted-foreground">{subtitle}</p>
            {children}
          </div>
        </div>

        <footer className="text-[12px] text-muted-foreground">
          &copy; {new Date().getFullYear()} {PRODUCT_NAME} &middot;{" "}
          <a href={DOCS_URL} className="hover:text-foreground">
            Docs
          </a>
        </footer>
      </div>

      <SceneAside
        headline="Know a model change is safe before you ship it."
        footnote={
          <>
            Compare every model and prompt change with your accepted baseline, case by case, and ship only when the gate passes.{" "}
            <a href={DOCS_URL} className="font-medium text-link underline-offset-4 hover:underline">
              Read the docs &rarr;
            </a>
          </>
        }
      >
        <DistilScene />
      </SceneAside>
    </main>
  );
}
