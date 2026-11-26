import json
import shlex
import uuid
from dataclasses import dataclass
from pathlib import Path

from modelstill.benchmark import Benchmark, History, load_benchmark
from modelstill.evals import Case, exact_match, run

TASK = "ticket-priority-example"

AREAS = (
    "checkout",
    "login",
    "the mobile app",
    "the reports dashboard",
    "single sign-on",
    "the public API",
    "invoicing",
    "search",
    "email notifications",
    "the admin console",
    "file uploads",
    "calendar sync",
    "team invites",
    "webhooks",
    "the billing portal",
    "the analytics page",
    "CSV import",
    "the audit log",
    "workspace settings",
    "the help center",
)

TIMES = ("this morning", "9am", "the last deploy", "an hour ago", "midnight")


@dataclass(frozen=True)
class Template:
    tag: str
    priority: str
    text: str


TEMPLATES = (
    Template("outage", "urgent", "{Area} is down for all of our users since {time}."),
    Template(
        "payments",
        "urgent",
        "Every card payment through {area} has failed since {time}; we are losing orders.",
    ),
    Template("data-exposure", "urgent", "Customers can see other customers' records in {area}."),
    Template("data-loss", "urgent", "Everything we saved in {area} since {time} is gone."),
    Template("account", "normal", "Can you update the billing contact we use for {area}?"),
    Template(
        "double-charge", "normal", "We were charged twice for {area} on this month's invoice."
    ),
    Template(
        "single-user-bug",
        "normal",
        "One person on our team gets an error every time she opens {area}.",
    ),
    Template("export", "normal", "The export from {area} leaves out the date column."),
    Template("typo", "low", "Small typo in the help article about {area}."),
    Template("feature-request", "low", "It would be nice to have a dark theme in {area}."),
    Template("question", "low", "Is there a keyboard shortcut for {area}?"),
    Template("cosmetic", "low", "The icon next to {area} looks slightly blurry on large screens."),
)


@dataclass(frozen=True)
class Candidate:
    model: str
    story: str
    mistakes: dict[str, tuple[int, str]]
    flip_rate: float
    cost_ratio: float
    p95_latency_ms: int


BASELINE = Candidate(
    "prompt-v1",
    "the accepted baseline",
    {"double-charge": (8, "urgent"), "feature-request": (4, "normal"), "data-loss": (4, "normal")},
    0.004,
    1.0,
    700,
)
IMPROVED = Candidate(
    "prompt-v2",
    "clearer billing rules and a shorter prompt",
    {"feature-request": (4, "normal"), "data-loss": (4, "normal"), "question": (2, "normal")},
    0.004,
    0.82,
    640,
)
BROKEN = Candidate(
    "prompt-v3",
    "a cheaper prompt that dropped the data-at-risk rule",
    {"feature-request": (4, "normal"), "data-loss": (4, "normal"), "data-exposure": (20, "normal")},
    0.004,
    0.55,
    590,
)
CANDIDATES = (BASELINE, IMPROVED, BROKEN)

SPEC = f"""task: {TASK}
version: 1
instruction: prompts/system.md
output_schema: schemas/out.json
requirements:
  - id: correct_priority
    priority: p0
    type: label
    instruction: The priority is low, normal or urgent, as the ticket text supports it.
labelling:
  teachers:
    - {{model: openai/gpt-5-mini, family: openai}}
    - {{model: anthropic/claude-haiku-4-5, family: anthropic}}
  disagreement: human_queue
eval:
  judge: {{model: google/gemini-2.5-flash, family: google}}
  golden_set: data/golden.jsonl
  gate:
    metric: correct_priority
    max_regression: 0.02
    max_flip_rate: 0.01
    max_cost_ratio: 1.0
    max_p95_latency_ms: 2000
train:
  base: Qwen/Qwen3-1.7B
  method: lora
  lora_r: 16
  seeds: [1, 2, 3]
serve:
  litellm_alias: {TASK}
  fallback: {TASK}-cloud
  target_error: 0.05
monitor:
  canary: data/canary.jsonl
  replay_frac: 0.3
"""

SYSTEM_PROMPT = """\
You triage customer support tickets. Read the ticket and answer with its priority.

- `urgent`: customers cannot use the product, money is being lost, or data is at risk.
- `normal`: a real problem or request for one customer, with no outage.
- `low`: cosmetic issues, typos and questions that can wait.

Answer with JSON only: {"priority": "low" | "normal" | "urgent"}
"""

OUTPUT_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "required": ["priority"],
    "properties": {"priority": {"type": "string", "enum": ["low", "normal", "urgent"]}},
}


@dataclass(frozen=True)
class Ticket:
    case: Case
    template: Template
    area_index: int


def _text(template: Template, area_index: int) -> str:
    area = AREAS[area_index]
    return template.text.format(
        area=area, Area=area[0].upper() + area[1:], time=TIMES[area_index % len(TIMES)]
    )


def tickets() -> tuple[Ticket, ...]:
    found: list[Ticket] = []
    for area_index in range(len(AREAS)):
        for template in TEMPLATES:
            case_id = f"ticket-{len(found) + 1:03d}"
            text = _text(template, area_index)
            found.append(
                Ticket(
                    Case(case_id, text, template.priority, (template.tag,)), template, area_index
                )
            )
    return tuple(found)


def answer(candidate: Candidate, ticket: Ticket) -> str:
    count, wrong = candidate.mistakes.get(ticket.template.tag, (0, ticket.template.priority))
    return wrong if ticket.area_index < count else ticket.template.priority


def run_id(candidate: Candidate) -> str:
    return uuid.uuid5(
        uuid.NAMESPACE_URL, f"https://modelstill.com/quickstart/{candidate.model}"
    ).hex


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def _check_target(target: Path) -> None:
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise FileExistsError(f"{target} exists and is not empty; choose a new directory")


def _write_task(task_dir: Path, all_tickets: tuple[Ticket, ...]) -> Benchmark:
    _write(task_dir / "spec.yaml", SPEC)
    _write(task_dir / "prompts" / "system.md", SYSTEM_PROMPT)
    _write(task_dir / "schemas" / "out.json", json.dumps(OUTPUT_SCHEMA, indent=2) + "\n")
    rows = [
        {
            "id": t.case.id,
            "input": t.case.input,
            "expected": t.case.expected,
            "tags": [*t.case.tags],
        }
        for t in all_tickets
    ]
    _write(task_dir / "data" / "golden.jsonl", "".join(json.dumps(row) + "\n" for row in rows))
    canary = [{"id": f"canary-{i + 1}", "input": row["input"]} for i, row in enumerate(rows[:2])]
    _write(task_dir / "data" / "canary.jsonl", "".join(json.dumps(row) + "\n" for row in canary))
    return load_benchmark(task_dir / "data" / "golden.jsonl")


def _record(history: History, benchmark: Benchmark, all_tickets: tuple[Ticket, ...]) -> None:
    for candidate in CANDIDATES:
        answers = {ticket.case.input: answer(candidate, ticket) for ticket in all_tickets}
        result = run(benchmark.cases, answers.__getitem__, exact_match)
        history.record(benchmark, candidate.model, result, run_id=run_id(candidate))
    history.accept(run_id(BASELINE))


def _readme() -> str:
    lines = [
        "# ModelStill quickstart (example data)",
        "",
        "Everything here is generated example data, not real support tickets or real model output.",
        "",
        f"- `tasks/{TASK}/`: the task spec, prompt, output schema and golden set.",
        "- `history.jsonl`: three recorded runs of the task; the baseline is accepted.",
        "",
        "| Run | Model | What changed | Flip rate | Cost ratio | p95 latency (ms) |",
        "|---|---|---|---|---|---|",
    ]
    lines += [
        f"| `{run_id(c)[:8]}` | {c.model} | {c.story} | {c.flip_rate} | {c.cost_ratio} "
        f"| {c.p95_latency_ms} |"
        for c in CANDIDATES
    ]
    return "\n".join(lines) + "\n"


def gate_command(target: Path, candidate: Candidate) -> str:
    spec = target / "tasks" / TASK / "spec.yaml"
    parts = [
        f"modelstill report gate {shlex.quote(str(target / 'history.jsonl'))} "
        f"{run_id(candidate)[:8]}",
        f"--spec {shlex.quote(str(spec))}",
        f"--previous {run_id(BASELINE)[:8]}",
        f"--flip-rate {candidate.flip_rate} --cost-ratio {candidate.cost_ratio} "
        f"--p95-latency-ms {candidate.p95_latency_ms}",
    ]
    return " \\\n    ".join(parts)


def _summary(target: Path, history: History) -> str:
    runs = {entry.model: entry for entry in history.runs()}
    task_dir, history_file = f"{target / 'tasks' / TASK}/", str(target / "history.jsonl")
    width = max(len(task_dir), len(history_file))
    cases = len(runs[BASELINE.model].result.scores)
    lines = [
        f"Wrote an example project to {target} (example data: generated tickets and recorded",
        "model answers, no API key or network needed).",
        "",
        f"  {task_dir:<{width}}  task spec, prompt and {cases} example tickets",
        f"  {history_file:<{width}}  three recorded runs, baseline accepted",
        "",
    ]
    for candidate in CANDIDATES:
        result = runs[candidate.model].result
        lines.append(
            f"  {run_id(candidate)[:8]}  {candidate.model}  accuracy {result.mean:.3f} "
            f"[{result.low:.3f}, {result.high:.3f}]  {candidate.story}"
        )
    lines += [
        "",
        "Flip rate, cost ratio and p95 latency are measured outside ModelStill; the example's",
        "recorded values are in the commands below.",
        "",
        f"Gate {IMPROVED.model} against the baseline (passes, exit code 0):",
        "",
        gate_command(target, IMPROVED),
        "",
        f"Gate {BROKEN.model} against the baseline (fails, exit code 2):",
        "",
        gate_command(target, BROKEN),
        "",
    ]
    return "\n".join(lines)


def write_quickstart(target: Path) -> str:
    _check_target(target)
    all_tickets = tickets()
    benchmark = _write_task(target / "tasks" / TASK, all_tickets)
    history = History(target / "history.jsonl")
    _record(history, benchmark, all_tickets)
    _write(target / "README.md", _readme())
    return _summary(target, history)
