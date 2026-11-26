import * as z from "zod/v4";
import { asText } from "./results.ts";

export type Shape = Record<string, z.ZodType>;

export function inputObject(shape: Shape): z.ZodType {
  return z.looseObject(shape);
}

function unknownArgs(args: Record<string, unknown>, shape: Shape): string[] {
  return Object.keys(args).filter((key) => args[key] !== undefined && !Object.hasOwn(shape, key));
}

function fold(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j]!;
      previous[j] = Math.min(above + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

function closeness(folded: string, candidate: string): number {
  const other = fold(candidate);
  if (other === folded) return 0;
  if (Math.min(folded.length, other.length) >= 4 && (other.includes(folded) || folded.includes(other))) return 1;
  const distance = editDistance(folded, other);
  return distance <= 2 ? 1 + distance : Infinity;
}

export function closestKey(key: string, known: readonly string[]): string | undefined {
  const folded = fold(key);
  if (!folded) return undefined;
  let best: { key: string; rank: number } | undefined;
  for (const candidate of known) {
    const rank = closeness(folded, candidate);
    if (rank !== Infinity && (!best || rank < best.rank)) best = { key: candidate, rank };
  }
  return best?.key;
}

export function refuseUnknownArgs(tool: string, args: Record<string, unknown>, shape: Shape) {
  const unknown = unknownArgs(args, shape);
  if (unknown.length === 0) return null;
  const known = Object.keys(shape);
  const lines = unknown.map((key) => {
    const meant = closestKey(key, known);
    const base = `${JSON.stringify(key)} is not a ${tool} argument.`;
    return meant ? `${base} Did you mean ${JSON.stringify(meant)}?` : base;
  });
  const accepted = known.length ? `${tool} takes: ${known.join(", ")}.` : `${tool} takes no arguments.`;
  return asText(
    {
      error: "unknown_arguments",
      message: `${lines.join(" ")} ${accepted}`,
      unknown_arguments: unknown,
      next_step: `Send the call again without ${unknown.length === 1 ? "that argument" : "those arguments"}.`,
      retryable: false,
    },
    true,
  );
}
