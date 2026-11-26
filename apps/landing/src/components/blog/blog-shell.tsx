import type { ReactNode } from "react";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { WashFilters } from "@/components/wash";

export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <>
      <WashFilters />
      <Header />
      <main className="mx-auto w-full max-w-[1180px] px-4 pt-8 pb-10 sm:px-6 sm:pt-14">{children}</main>
      <Footer />
    </>
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
