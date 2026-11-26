import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type * as z from "zod/v4";
import { asStructured, errorResult, type NextSteps, titled } from "./results.ts";
import { inputObject, refuseUnknownArgs, type Shape } from "./strict-args.ts";

export type ToolArgs = Record<string, unknown>;

export type Hints = Required<Pick<ToolAnnotations, "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint">>;

export const READ_HINTS: Hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  input: Shape;
  output: Record<string, z.ZodType>;
  hints: Hints;
  steps?: NextSteps;
  handler: (args: ToolArgs) => Promise<Record<string, unknown>>;
}

type ToolResult = ReturnType<typeof asStructured> | ReturnType<typeof errorResult>;

type LooseRegister = (
  name: string,
  config: Record<string, unknown>,
  callback: (args: ToolArgs) => Promise<ToolResult>,
) => unknown;

export function registerApiTool(server: McpServer, spec: ToolSpec): void {
  const register = server.registerTool.bind(server) as unknown as LooseRegister;
  register(
    spec.name,
    {
      ...titled(spec.title, spec.hints),
      description: spec.description,
      inputSchema: inputObject(spec.input) as unknown as ZodRawShapeCompat,
      outputSchema: spec.output as unknown as ZodRawShapeCompat,
    },
    async (args: ToolArgs) => {
      const refused = refuseUnknownArgs(spec.name, args, spec.input);
      if (refused) return refused;
      try {
        return asStructured(await spec.handler(args));
      } catch (error) {
        return errorResult(error, spec.steps);
      }
    },
  );
}
