import hashlib
import json
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Literal, cast, get_args

ReviewState = Literal["none", "queued", "accepted", "corrected"]
REVIEW_STATES: tuple[str, ...] = get_args(ReviewState)
SETTLED_BY_REVIEW = frozenset({"accepted", "corrected"})

Teacher = Callable[[Any], str]
"""A teacher answers one item input with the output text."""

Compare = Callable[[str, str], bool]
"""Whether two teacher outputs count as the same answer."""


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def input_hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


@dataclass(frozen=True)
class Provenance:
    source: str
    keys: Mapping[str, str]
    builder: str


@dataclass(frozen=True)
class TeacherOutput:
    output: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.output is not None and self.error is None


@dataclass(frozen=True)
class DatasetItem:
    input: Any
    input_hash: str
    provenance: Provenance
    outputs: Mapping[str, TeacherOutput] = field(default_factory=dict)
    agreement: bool | None = None
    review_state: ReviewState = "none"
    final_output: str | None = None

    @classmethod
    def create(
        cls,
        value: Any,
        provenance: Provenance,
        outputs: Mapping[str, TeacherOutput] | None = None,
    ) -> "DatasetItem":
        return cls(value, input_hash(value), provenance, dict(outputs or {}))

    def with_outputs(self, outputs: Mapping[str, TeacherOutput]) -> "DatasetItem":
        return replace(self, outputs={**self.outputs, **outputs})

    def with_review(self, state: ReviewState, final_output: str | None = None) -> "DatasetItem":
        if state not in REVIEW_STATES:
            raise ValueError(f"unknown review_state {state!r}")
        return replace(
            self,
            review_state=state,
            final_output=final_output if final_output is not None else self.final_output,
        )

    @property
    def settled(self) -> bool:
        if self.final_output is None:
            return False
        return self.agreement is True or self.review_state in SETTLED_BY_REVIEW

    def matches(self, ids: Iterable[str] | set[str]) -> bool:
        wanted = ids if isinstance(ids, set) else set(ids)
        return self.input_hash in wanted or any(v in wanted for v in self.provenance.keys.values())

    def to_json(self) -> dict[str, Any]:
        return {
            "input_hash": self.input_hash,
            "input": self.input,
            "provenance": {
                "source": self.provenance.source,
                "keys": dict(self.provenance.keys),
                "builder": self.provenance.builder,
            },
            "outputs": {
                name: {"output": out.output, "error": out.error}
                for name, out in self.outputs.items()
            },
            "agreement": self.agreement,
            "review_state": self.review_state,
            "final_output": self.final_output,
        }

    @classmethod
    def from_json(cls, row: Mapping[str, Any]) -> "DatasetItem":
        value = row["input"]
        if input_hash(value) != row["input_hash"]:
            raise ValueError(f"input_hash {row['input_hash']} does not match the input")
        state = row.get("review_state", "none")
        if state not in REVIEW_STATES:
            raise ValueError(f"unknown review_state {state!r}")
        prov = row["provenance"]
        return cls(
            input=value,
            input_hash=row["input_hash"],
            provenance=Provenance(prov["source"], dict(prov["keys"]), prov["builder"]),
            outputs={
                name: TeacherOutput(out.get("output"), out.get("error"))
                for name, out in row.get("outputs", {}).items()
            },
            agreement=row.get("agreement"),
            review_state=cast(ReviewState, state),
            final_output=row.get("final_output"),
        )


class DatasetStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def _latest(self) -> dict[str, DatasetItem]:
        if not self.path.exists():
            return {}
        latest: dict[str, DatasetItem] = {}
        with self.path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    found = DatasetItem.from_json(json.loads(line))
                    latest[found.input_hash] = found
        return latest

    def _append(self, items: Sequence[DatasetItem]) -> None:
        if not items:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            for found in items:
                handle.write(_canonical(found.to_json()) + "\n")

    def load(self) -> list[DatasetItem]:
        return list(self._latest().values())

    def add(self, items: Iterable[DatasetItem]) -> int:
        known = set(self._latest())
        fresh: list[DatasetItem] = []
        for found in items:
            if found.input_hash not in known:
                known.add(found.input_hash)
                fresh.append(found)
        self._append(fresh)
        return len(fresh)

    def save(self, items: Iterable[DatasetItem]) -> int:
        latest = self._latest()
        changed: list[DatasetItem] = []
        for found in items:
            if latest.get(found.input_hash) != found:
                latest[found.input_hash] = found
                changed.append(found)
        self._append(changed)
        return len(changed)

    def version(self) -> str:
        current = sorted(self._latest().values(), key=lambda found: found.input_hash)
        return hashlib.sha256(_canonical([i.to_json() for i in current]).encode()).hexdigest()


@dataclass(frozen=True)
class LabelReport:
    items: list[DatasetItem]
    calls: int
    failed: int
    skipped: int
    agreed: int
    disagreed: int


def _decide(
    found: DatasetItem, names: Sequence[str], compare: Compare, prefer: str | None
) -> DatasetItem:
    outputs = [found.outputs.get(name) for name in names]
    if len(names) < 2 or any(out is None or not out.ok for out in outputs):
        return replace(found, agreement=None, final_output=None, review_state="none")
    texts = [cast(str, out.output) for out in outputs if out is not None]
    agree = all(compare(texts[0], text) for text in texts[1:])
    if not agree:
        return replace(found, agreement=False, final_output=None, review_state="queued")
    chosen = prefer if prefer is not None and prefer in names else names[0]
    return replace(
        found, agreement=True, final_output=found.outputs[chosen].output, review_state="none"
    )


def label(
    items: Sequence[DatasetItem],
    teachers: Mapping[str, Teacher],
    compare: Compare,
    workers: int = 8,
    max_calls: int | None = None,
    prefer: str | None = None,
) -> LabelReport:
    planned: list[tuple[int, str]] = []
    for index, found in enumerate(items):
        if found.review_state in SETTLED_BY_REVIEW:
            continue
        for name in teachers:
            existing = found.outputs.get(name)
            if existing is None or not existing.ok:
                planned.append((index, name))
    allowed = planned if max_calls is None else planned[: max(max_calls, 0)]

    def ask(call: tuple[int, str]) -> TeacherOutput:
        index, name = call
        try:
            return TeacherOutput(output=teachers[name](items[index].input))
        except Exception as error:  # noqa: BLE001
            return TeacherOutput(error=f"{type(error).__name__}: {error}")

    with ThreadPoolExecutor(max_workers=max(workers, 1)) as pool:
        answers = list(pool.map(ask, allowed))

    new_outputs: dict[int, dict[str, TeacherOutput]] = {}
    for (index, name), answer in zip(allowed, answers, strict=True):
        new_outputs.setdefault(index, {})[name] = answer

    labelled: list[DatasetItem] = []
    for index, found in enumerate(items):
        if found.review_state in SETTLED_BY_REVIEW:
            labelled.append(found)
            continue
        updated = found.with_outputs(new_outputs.get(index, {}))
        names = list(dict.fromkeys([*updated.outputs, *teachers]))
        labelled.append(_decide(updated, names, compare, prefer))

    return LabelReport(
        items=labelled,
        calls=len(allowed),
        failed=sum(1 for answer in answers if not answer.ok),
        skipped=len(planned) - len(allowed),
        agreed=sum(1 for found in labelled if found.agreement is True),
        disagreed=sum(1 for found in labelled if found.agreement is False),
    )


class LeakageError(Exception):
    pass


@dataclass(frozen=True)
class Split:
    seed: str
    fractions: Mapping[str, float]
    assignments: Mapping[str, str]
    excluded: int = 0

    @property
    def version(self) -> str:
        body = {
            "seed": self.seed,
            "fractions": list(self.fractions.items()),
            "assignments": sorted(self.assignments.items()),
        }
        return hashlib.sha256(_canonical(body).encode()).hexdigest()

    def counts(self) -> dict[str, int]:
        counted = Counter(self.assignments.values())
        return {name: counted.get(name, 0) for name in self.fractions}

    def items_in(self, name: str, items: Iterable[DatasetItem]) -> list[DatasetItem]:
        return [found for found in items if self.assignments.get(found.input_hash) == name]

    def to_json(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "seed": self.seed,
            "fractions": dict(self.fractions),
            "excluded": self.excluded,
            "assignments": dict(sorted(self.assignments.items())),
        }

    @classmethod
    def from_json(cls, row: Mapping[str, Any]) -> "Split":
        loaded = cls(
            seed=row["seed"],
            fractions=dict(row["fractions"]),
            assignments=dict(row["assignments"]),
            excluded=row.get("excluded", 0),
        )
        if "version" in row and row["version"] != loaded.version:
            raise ValueError("split version does not match its assignments")
        return loaded


def _unit(seed: str, key: str) -> float:
    digest = hashlib.sha256(f"{seed}\0{key}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def check_no_leakage(
    result: Split, items: Iterable[DatasetItem], exclude: Iterable[str], train: str = "train"
) -> None:
    wanted = set(exclude)
    leaked = [
        found
        for found in items
        if found.matches(wanted) and result.assignments.get(found.input_hash) == train
    ]
    if leaked:
        raise LeakageError(f"{len(leaked)} excluded items are assigned to {train!r}")


def split(
    items: Iterable[DatasetItem],
    fractions: Mapping[str, float],
    seed: str,
    exclude: Iterable[str] = (),
    group: Callable[[DatasetItem], str] | None = None,
) -> Split:
    if any(share < 0 for share in fractions.values()) or abs(sum(fractions.values()) - 1) > 1e-9:
        raise ValueError(f"fractions must be non-negative and sum to 1, got {dict(fractions)}")
    wanted = set(exclude)
    names = list(fractions)
    bounds: list[float] = []
    total = 0.0
    for name in names:
        total += fractions[name]
        bounds.append(total)
    assignments: dict[str, str] = {}
    excluded = 0
    materialised = list(items)
    for found in materialised:
        if found.matches(wanted):
            excluded += 1
            continue
        point = _unit(seed, found.input_hash if group is None else f"group\0{group(found)}")
        part = next((n for n, b in zip(names, bounds, strict=True) if point < b), names[-1])
        assignments[found.input_hash] = part
    result = Split(seed, dict(fractions), assignments, excluded)
    check_no_leakage(result, materialised, wanted)
    return result


def to_sft_jsonl(
    items: Iterable[DatasetItem],
    path: Path,
    system_prompt: str,
    render_input: Callable[[Any], str],
    target: str | None = None,
    keep: Callable[[str], bool] | None = None,
) -> int:
    def answer(found: DatasetItem) -> str | None:
        if target is None:
            return found.final_output if found.settled else None
        recorded = found.outputs.get(target)
        return recorded.output if recorded is not None and recorded.ok else None

    chosen = [(found, text) for found in items if (text := answer(found)) is not None]
    rows = [
        {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": render_input(found.input)},
                {"role": "assistant", "content": text},
            ]
        }
        for found, text in chosen
        if keep is None or keep(text)
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))
    return len(rows)


__all__ = [
    "REVIEW_STATES",
    "Compare",
    "DatasetItem",
    "DatasetStore",
    "LabelReport",
    "LeakageError",
    "Provenance",
    "ReviewState",
    "Split",
    "Teacher",
    "TeacherOutput",
    "check_no_leakage",
    "input_hash",
    "label",
    "split",
    "to_sft_jsonl",
]
