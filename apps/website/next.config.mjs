import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const config = {
  reactStrictMode: true,
  outputFileTracingRoot: join(here, "../.."),
  transpilePackages: ["@modelstill/ui"],
};

export default config;
