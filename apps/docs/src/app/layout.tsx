import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { source } from "@/lib/source";
import { withDocumentationTab } from "@/lib/layout-tree";
import { DASHBOARD_URL, DOCS_URL, GITHUB_URL } from "@/lib/site";
import { BrandMark } from "@/components/brand-mark";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL(DOCS_URL),
  title: {
    default: "ModelStill Documentation",
    template: "%s · ModelStill Docs",
  },
  description:
    "ModelStill documentation: an open-source LLM eval framework for CI. Regression-test prompt and model changes against golden datasets, validate LLM-as-a-judge against people, and gate releases with confidence intervals.",
};

const tree = withDocumentationTab(source.pageTree);

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ defaultTheme: "light" }} search={{ options: { type: "static", api: "/search-index.json" } }}>
          <DocsLayout
            tree={tree}
            tabMode="navbar"
            githubUrl={GITHUB_URL}
            nav={{
              mode: "top",
              title: (
                <span className="inline-flex items-center gap-2 text-[17px] font-bold tracking-tight">
                  <BrandMark size={22} />
                  ModelStill
                </span>
              ),
              url: "/",
            }}
            tabs={{
              transform: (tab) => ({
                ...tab,
                title: (
                  <span className="inline-flex items-center gap-1.5 [&_svg]:size-4">
                    {tab.icon}
                    {tab.title}
                  </span>
                ),
              }),
            }}
            links={[
              {
                type: "custom",
                on: "nav",
                secondary: true,
                children: (
                  <span className="flex items-center gap-2">
                    <a href={`${DASHBOARD_URL}/login`} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-fd-foreground hover:bg-fd-accent">
                      Sign in
                    </a>
                    <a href={`${DASHBOARD_URL}/settings/api-keys`} className="rounded-lg bg-fd-primary px-3.5 py-1.5 text-sm font-semibold text-fd-primary-foreground shadow-sm hover:opacity-90">
                      Get API key
                    </a>
                  </span>
                ),
              },
              { text: "Sign in", url: `${DASHBOARD_URL}/login`, on: "menu" },
              { text: "Get API key", url: `${DASHBOARD_URL}/settings/api-keys`, on: "menu" },
            ]}
          >
            {children}
          </DocsLayout>
        </RootProvider>
      </body>
    </html>
  );
}
