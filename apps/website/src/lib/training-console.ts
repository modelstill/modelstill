import type { TrainRun, TrainSeries } from "./api";

export type ConsoleEvent =
  | { key: string; kind: "start"; step: null; values: Record<string, unknown> }
  | { key: string; kind: "train"; step: null; values: { firstStep: number; lastStep: number; points: number } }
  | { key: string; kind: "eval"; step: number; values: Record<string, number | null> }
  | { key: string; kind: "finish"; step: null; values: Record<string, number> };

export function consoleEvents(run: TrainRun, series: TrainSeries): ConsoleEvent[] {
  const events: ConsoleEvent[] = [{ key: "start", kind: "start", step: null, values: { base: run.base, method: run.method, startedAt: run.startedAt } }];
  const loss = series["loss"] ?? [];
  if (loss.length > 0) {
    const steps = loss.map((point) => point.step);
    events.push({ key: "train", kind: "train", step: null, values: { firstStep: Math.min(...steps), lastStep: Math.max(...steps), points: loss.length } });
  }
  const evalNames = Object.keys(series).filter((name) => name.startsWith("eval_")).sort();
  const evalSteps = [...new Set(evalNames.flatMap((name) => series[name]!.map((point) => point.step)))].sort((a, b) => a - b);
  for (const step of evalSteps) {
    const values: Record<string, number | null> = {};
    for (const name of evalNames) {
      const point = series[name]!.find((entry) => entry.step === step);
      if (point) {
        values["epoch"] ??= point.epoch;
        values[name] = point.value;
      }
    }
    events.push({ key: `eval-${step}`, kind: "eval", step, values });
  }
  if (run.status !== "running") events.push({ key: "finish", kind: "finish", step: null, values: run.finalMetrics ?? {} });
  return events;
}

export function formatDuration(start: string, end: string | null): string | null {
  if (!end) return null;
  const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

export function artifactPath(slug: string, key: string): string {
  const prefix = `${slug}-`;
  return `artifacts/${slug}/${key.startsWith(prefix) ? key.slice(prefix.length) : key}`;
}

const SERVE_BASE_URL = "http://127.0.0.1:8100/v1";
const STUDENT_KEY_ENV = "MODELSTILL_STUDENT_KEY";

export type Snippet = { value: string; label: string; code: string };

export function servedSnippets(servedName: string): Snippet[] {
  return [
    {
      value: "python",
      label: "Python",
      code: [
        "from openai import OpenAI",
        "import os",
        "",
        `client = OpenAI(base_url="${SERVE_BASE_URL}", api_key=os.environ["${STUDENT_KEY_ENV}"])`,
        "reply = client.chat.completions.create(",
        `    model="${servedName}",`,
        '    messages=[{"role": "user", "content": "..."}],',
        ")",
        "print(reply.choices[0].message.content)",
      ].join("\n"),
    },
    {
      value: "typescript",
      label: "TypeScript",
      code: [
        'import OpenAI from "openai";',
        "",
        `const client = new OpenAI({ baseURL: "${SERVE_BASE_URL}", apiKey: process.env.${STUDENT_KEY_ENV} });`,
        "const reply = await client.chat.completions.create({",
        `  model: "${servedName}",`,
        '  messages: [{ role: "user", content: "..." }],',
        "});",
      ].join("\n"),
    },
    {
      value: "curl",
      label: "cURL",
      code: [
        `curl ${SERVE_BASE_URL}/chat/completions \\`,
        `  -H "Authorization: Bearer $${STUDENT_KEY_ENV}" \\`,
        '  -H "content-type: application/json" \\',
        `  -d '{"model":"${servedName}","messages":[{"role":"user","content":"..."}]}'`,
      ].join("\n"),
    },
  ];
}

export function exportSnippets(slug: string, key: string): Snippet[] {
  const artifact = artifactPath(slug, key);
  return [
    { value: "serve", label: "Serve", code: `uv run modelstill serve up ${artifact} --host <gpu-host> --gpu 1 --port 8100` },
    { value: "peft", label: "PEFT", code: `uv run modelstill export ${artifact} --to peft --out out/peft` },
    { value: "gguf", label: "GGUF", code: `uv run modelstill export ${artifact} --to gguf --outtype q8_0 --out out/gguf --host <gpu-host> --gpu 1` },
  ];
}
