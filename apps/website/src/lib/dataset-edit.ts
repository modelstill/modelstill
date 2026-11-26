export type FieldFormat = "text" | "json" | "metadata";

export type FieldText = { format: "text" | "json"; text: string };

export function fieldText(value: unknown): FieldText {
  if (typeof value === "string") return { format: "text", text: value };
  return { format: "json", text: JSON.stringify(value ?? null, null, 2) };
}

export type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

export function parseFieldText(text: string, format: FieldFormat): Parsed {
  if (format === "text") return { ok: true, value: text };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "not valid JSON" };
  }
  if (format === "metadata" && (!value || typeof value !== "object" || Array.isArray(value))) {
    return { ok: false, message: "metadata is a JSON object" };
  }
  return { ok: true, value };
}

export type EditableRow = { input: unknown; expected: unknown; metadata: Record<string, unknown> };

export function changedFields(row: EditableRow, next: EditableRow): Partial<EditableRow> {
  const changed: Partial<EditableRow> = {};
  if (JSON.stringify(row.input) !== JSON.stringify(next.input)) changed.input = next.input;
  if (JSON.stringify(row.expected) !== JSON.stringify(next.expected)) changed.expected = next.expected;
  if (JSON.stringify(row.metadata) !== JSON.stringify(next.metadata)) changed.metadata = next.metadata;
  return changed;
}

export type AutosaveState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "saving" }
  | { status: "saved"; version: number }
  | { status: "error"; message: string }
  | { status: "conflict"; head: number };

export type AutosaveOptions<P> = {
  delayMs: number;
  base: number;
  write: (key: string, patch: P, base: number) => Promise<number>;
  onState: (state: AutosaveState) => void;
};

function conflictHead(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (status !== 409 || !body || typeof body !== "object") return null;
  const head = (body as { error?: unknown; head?: unknown }).head;
  return (body as { error?: unknown }).error === "version_conflict" && typeof head === "number" ? head : null;
}

export function createAutosave<P extends object>({ delayMs, base: initialBase, write, onState }: AutosaveOptions<P>) {
  let base = initialBase;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();
  let blocked = false;
  const pending = new Map<string, P>();

  async function drain(): Promise<void> {
    while (pending.size > 0 && !blocked) {
      const [key, patch] = pending.entries().next().value as [string, P];
      pending.delete(key);
      onState({ status: "saving" });
      try {
        base = await write(key, patch, base);
        if (pending.size === 0) onState({ status: "saved", version: base });
      } catch (error) {
        const head = conflictHead(error);
        if (head !== null) {
          blocked = true;
          pending.clear();
          onState({ status: "conflict", head });
          return;
        }
        pending.set(key, { ...patch, ...pending.get(key) });
        onState({ status: "error", message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
  }

  function start(): Promise<void> {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    running = running.then(drain);
    return running;
  }

  return {
    schedule(key: string, patch: P) {
      if (blocked) return;
      pending.set(key, { ...pending.get(key), ...patch });
      onState({ status: "pending" });
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void start(), delayMs);
    },
    flush(): Promise<void> {
      return start();
    },
    reset(nextBase: number) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending.clear();
      blocked = false;
      base = nextBase;
      onState({ status: "idle" });
    },
    get base() {
      return base;
    },
  };
}

export type Autosave<P extends object> = ReturnType<typeof createAutosave<P>>;
