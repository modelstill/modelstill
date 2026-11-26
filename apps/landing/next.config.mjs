import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const config = {
  reactStrictMode: true,
  output: "export",
  images: { unoptimized: true },
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default config;
