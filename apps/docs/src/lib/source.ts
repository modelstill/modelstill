import { loader, type StaticSource } from "fumadocs-core/source";
import { docs } from "../../.source/server";
import { phosphorIconsPlugin } from "./icons";
import { openapi } from "./openapi";

type DocsSource = StaticSource<{
  pageData: (typeof docs.docs)[number];
  metaData: (typeof docs.meta)[number];
}>;

export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource() satisfies DocsSource as DocsSource,
  plugins: [phosphorIconsPlugin(), openapi.loaderPlugin()],
});
