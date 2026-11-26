import { createApp } from "./app.ts";
import { readConfig } from "./env.ts";

export function createServer(env: Record<string, string | undefined>) {
  const config = readConfig(env);
  const app = createApp({ config });
  return { port: config.port, config, fetch: app.fetch };
}
