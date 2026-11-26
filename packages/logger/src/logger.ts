import pino from "pino";
import { traceMixin } from "./trace-mixin.ts";

function buildBase() {
  const opts = {
    level: process.env.LOG_LEVEL ?? "info",
    base: { service: process.env.SERVICE_NAME ?? "modelstill" },
    mixin: traceMixin,
  };
  const wantAxiom = process.env.AXIOM_LOGS === "true";
  const dataset = process.env.AXIOM_DATASET ?? "modelstill-api";
  if (wantAxiom && process.env.AXIOM_TOKEN) {
    process.stderr.write(`[logger] Axiom transport enabled (dataset=${dataset})\n`);
    return pino(
      opts,
      pino.transport({
        targets: [
          { target: "pino/file", options: { destination: 1 } },
          {
            target: "@axiomhq/pino",
            options: { dataset, token: process.env.AXIOM_TOKEN },
          },
        ],
      }),
    );
  }
  if (wantAxiom) {
    process.stderr.write(
      "[logger] WARNING: AXIOM_LOGS=true but AXIOM_TOKEN is unset — logs go to stdout ONLY, nothing reaches Axiom\n",
    );
  }
  return pino(opts);
}

const base = buildBase();

type Meta = Record<string, unknown> | undefined;

function adapt(level: "info" | "warn" | "error" | "debug") {
  return (message: unknown, meta?: Meta) => {
    if (meta && typeof meta === "object") {
      base[level](meta, String(message));
    } else {
      base[level](String(message));
    }
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => base.flush(() => resolve()));
}

export const logger = {
  info: adapt("info"),
  warn: adapt("warn"),
  error: adapt("error"),
  debug: adapt("debug"),
  flush,
  raw: base,
};

export type Logger = typeof logger;
