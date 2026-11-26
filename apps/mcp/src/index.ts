import { createServer } from "./server.ts";

const server = createServer(process.env);

const running = Bun.serve({ port: server.port, fetch: server.fetch });

console.info(`modelstill mcp on :${server.port} (api: ${server.config.apiUrl}, public: ${server.config.publicUrl})`);

function shutdown(signal: string) {
  console.info(`received ${signal}, shutting down`);
  void running.stop().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
