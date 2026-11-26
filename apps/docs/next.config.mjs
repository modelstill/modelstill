import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const staticExport = process.env.DOCS_STATIC_EXPORT === "1";

const config = {
  reactStrictMode: true,
  outputFileTracingRoot: root,
  turbopack: { root },
  ...(staticExport ? { output: "export", images: { unoptimized: true } } : {}),
  async redirects() {
    if (staticExport) return [];
    return [
      { source: "/api", destination: "/api-reference", permanent: false },
      { source: "/api/:path*", destination: "/api-reference/:path*", permanent: false },
      { source: "/cli", destination: "/reference/cli", permanent: false },
      { source: "/spec", destination: "/reference/task-spec", permanent: false },
      { source: "/mcp", destination: "/ai-agents/mcp", permanent: false },
      { source: "/skill", destination: "/ai-agents/skill", permanent: false },
    ];
  },
};

const withMDX = createMDX();

export default withMDX(config);
