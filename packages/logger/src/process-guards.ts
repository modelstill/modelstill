import type { EventEmitter } from "node:events";
import type { Logger } from "./logger.ts";

const STACK_LINES = 8;
const CAUSE_DEPTH = 3;
const FLUSH_MS = 2000;

export type ProcessErrorKind = "unhandled_rejection" | "uncaught_exception";

export interface ProcessGuardOptions {
  logger: Pick<Logger, "error">;
  report?: (error: unknown, kind: ProcessErrorKind) => void;
  flush?: () => Promise<unknown>;
  exit?: (code: number) => void;
  proc?: Pick<EventEmitter, "on">;
}

const OMITTED_FIELDS = new Set(["name", "message", "stack", "cause"]);

export function errorFields(error: unknown, depth = CAUSE_DEPTH): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };
  const own: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (!OMITTED_FIELDS.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) own[key] = value;
  }
  return {
    name: error.name,
    error: error.message,
    ...own,
    stack: error.stack?.split("\n").slice(0, STACK_LINES).join("\n"),
    ...(error.cause !== undefined && depth > 0 ? { cause: errorFields(error.cause, depth - 1) } : {}),
  };
}

function exitProcess(code: number): void {
  process.exit(code);
}

function bounded(work: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([work.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))]);
}

export function installProcessGuards(options: ProcessGuardOptions): void {
  const proc = options.proc ?? process;
  const exit = options.exit ?? exitProcess;

  function logAndReport(kind: ProcessErrorKind, error: unknown): void {
    options.logger.error(kind, errorFields(error));
    try {
      options.report?.(error, kind);
    } catch {
    }
  }

  proc.on("unhandledRejection", (reason: unknown) => {
    logAndReport("unhandled_rejection", reason);
  });
  proc.on("uncaughtException", (error: unknown) => {
    logAndReport("uncaught_exception", error);
    const flushed = options.flush ? bounded(options.flush(), FLUSH_MS) : Promise.resolve();
    void flushed.then(() => exit(1));
  });
}
