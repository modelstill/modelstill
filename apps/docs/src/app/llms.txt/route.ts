import { source } from "@/lib/source";
import { API_URL, DOCS_URL } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const lines = [
    "# ModelStill Docs",
    "",
    "> Documentation for ModelStill: task specs, evals with intervals, the release gate, model swaps, training a small student, serving it behind LiteLLM, monitoring, the API and the MCP server.",
    "",
    "## Pages",
    "",
    ...source.getPages().map((page) => {
      const url = `${DOCS_URL}${page.url === "/" ? "" : page.url}`;
      const description = page.data.description ? `: ${page.data.description}` : "";
      return `- [${page.data.title}](${url})${description}`;
    }),
    "",
    "## Related",
    `- [OpenAPI document](${API_URL}/openapi.json)`,
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
