import { createServer } from "./server.ts";

const server = createServer(process.env);

Bun.serve({ port: server.port, fetch: server.fetch });

console.info(`modelstill api on :${server.port} (store: ${server.storeKind}, traffic: ${server.trafficKind})`);
