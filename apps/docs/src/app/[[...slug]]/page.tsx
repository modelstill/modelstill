import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { GeneratedPageProps } from "fumadocs-openapi";
import { source } from "@/lib/source";
import { openapi } from "@/lib/openapi";
import { OpenAPIPage } from "@/components/api-page";
import { PageActions } from "@/components/page-actions";
import { Screenshot } from "@/components/screenshot";

const baseComponents = {
  ...defaultMdxComponents,
  Tab,
  Tabs,
  Card,
  Cards,
  Step,
  Steps,
  Accordion,
  Accordions,
  Screenshot,
};

type Params = { slug?: string[] };

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) return {};
  const path = slug && slug.length ? `/${slug.join("/")}` : "/";
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: path },
  };
}

export default async function DocsPageRoute({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <DocsTitle>{page.data.title}</DocsTitle>
        <PageActions path={page.url} />
      </div>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={{
            ...baseComponents,
            OpenAPIPage: async (props: GeneratedPageProps) => (
              <OpenAPIPage {...(await openapi.preloadOpenAPIPage(page))} {...props} />
            ),
          }}
        />
      </DocsBody>
    </DocsPage>
  );
}
