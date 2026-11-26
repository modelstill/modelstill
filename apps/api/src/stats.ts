export const BOOTSTRAP_SEED = 0;
export const BOOTSTRAP_ROUNDS = 2000;

export type Interval = { low: number; high: number };

export type CaseScore = { inputHash: string; score: number; metrics?: Record<string, number> };

export type PairedCase = { inputHash: string; before: number; after: number };

export type Verdict = "better" | "worse" | "no_detectable_difference";

export type Comparison = {
  difference: number;
  low: number;
  high: number;
  verdict: Verdict;
  fixed: number;
  broken: number;
  cases: PairedCase[];
};

export class DifferentCasesError extends Error {
  constructor() {
    super("the runs scored different cases");
  }
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function bootstrapMean(
  values: readonly number[],
  seed: number = BOOTSTRAP_SEED,
  rounds: number = BOOTSTRAP_ROUNDS,
): Interval {
  const random = seededRandom(seed);
  const size = values.length;
  const means: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    let total = 0;
    for (let draw = 0; draw < size; draw += 1) total += values[Math.floor(random() * size)]!;
    means.push(total / size);
  }
  means.sort((left, right) => left - right);
  return { low: means[Math.floor(0.025 * rounds)]!, high: means[Math.floor(0.975 * rounds) - 1]! };
}

function binomialCdf(successes: number, trials: number, probability: number): number {
  if (probability <= 0) return 1;
  if (probability >= 1) return successes >= trials ? 1 : 0;
  const logP = Math.log(probability);
  const logQ = Math.log(1 - probability);
  let logChoose = 0;
  let total = 0;
  for (let count = 0; count <= successes; count += 1) {
    if (count > 0) logChoose += Math.log(trials - count + 1) - Math.log(count);
    total += Math.exp(logChoose + count * logP + (trials - count) * logQ);
  }
  return Math.min(1, total);
}

function bisect(decreasing: (probability: number) => number, target: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 100; step += 1) {
    const middle = (low + high) / 2;
    if (decreasing(middle) > target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function clopperPearson(successes: number, trials: number, confidence = 0.95): Interval {
  const tail = (1 - confidence) / 2;
  const low =
    successes === 0 ? 0 : bisect((probability) => binomialCdf(successes - 1, trials, probability), 1 - tail);
  const high =
    successes === trials ? 1 : bisect((probability) => binomialCdf(successes, trials, probability), tail);
  return { low, high };
}

export function signTest(fixed: number, broken: number): number {
  const trials = fixed + broken;
  if (trials === 0) return 1;
  return Math.min(1, 2 * binomialCdf(Math.min(fixed, broken), trials, 0.5));
}

export function summarizeScores(values: readonly number[]) {
  return { mean: mean(values), ...bootstrapMean(values), cases: values.length };
}

function byHash(scores: readonly CaseScore[]): Map<string, number> {
  return new Map(scores.map((entry) => [entry.inputHash, entry.score]));
}

function pair(before: readonly CaseScore[], after: readonly CaseScore[]): PairedCase[] {
  const beforeScores = byHash(before);
  const afterScores = byHash(after);
  const sameSet =
    beforeScores.size === afterScores.size &&
    [...beforeScores.keys()].every((inputHash) => afterScores.has(inputHash));
  if (!sameSet || beforeScores.size === 0) throw new DifferentCasesError();
  return [...beforeScores.keys()]
    .sort()
    .map((inputHash) => ({
      inputHash,
      before: beforeScores.get(inputHash)!,
      after: afterScores.get(inputHash)!,
    }));
}

export function verdictFor(interval: Interval): Verdict {
  if (interval.low > 0) return "better";
  if (interval.high < 0) return "worse";
  return "no_detectable_difference";
}

export function compareScores(before: readonly CaseScore[], after: readonly CaseScore[]): Comparison {
  const cases = pair(before, after);
  const differences = cases.map((entry) => entry.after - entry.before);
  const interval = bootstrapMean(differences);
  return {
    difference: mean(differences),
    ...interval,
    verdict: verdictFor(interval),
    fixed: differences.filter((value) => value > 0).length,
    broken: differences.filter((value) => value < 0).length,
    cases,
  };
}

export type MetricEstimate = { value: number; low: number; high: number };

export type MetricComparison = {
  name: string;
  before: MetricEstimate | null;
  after: MetricEstimate | null;
  difference: number | null;
  low: number | null;
  high: number | null;
  paired: boolean;
  verdict: Verdict | null;
  improved: number | null;
  regressed: number | null;
};

export type ScoredRun = { metrics: Record<string, MetricEstimate>; scores: readonly CaseScore[] };

function perCase(scores: readonly CaseScore[], name: string): number[] | null {
  const values = scores.map((entry) => entry.metrics?.[name]);
  if (values.length === 0 || values.some((value) => typeof value !== "number")) return null;
  return values as number[];
}

function pairedValues(before: ScoredRun, after: ScoredRun, name: string): [number[], number[]] | null {
  const afterByHash = new Map(after.scores.map((entry) => [entry.inputHash, entry]));
  const ordered = before.scores.map((entry) => afterByHash.get(entry.inputHash));
  if (ordered.some((entry) => entry === undefined)) return null;
  const left = perCase(before.scores, name);
  const right = perCase(ordered as CaseScore[], name);
  return left && right ? [left, right] : null;
}

function estimateOf(run: ScoredRun, name: string): MetricEstimate | null {
  const stored = run.metrics[name];
  if (stored) return stored;
  const values = perCase(run.scores, name);
  if (!values) return null;
  const { mean: value, low, high } = summarizeScores(values);
  return { value, low, high };
}

function metricNames(before: ScoredRun, after: ScoredRun): string[] {
  const names = new Set([...Object.keys(before.metrics), ...Object.keys(after.metrics)]);
  const caseNames = new Set(before.scores.flatMap((entry) => Object.keys(entry.metrics ?? {})));
  for (const name of caseNames) if (pairedValues(before, after, name)) names.add(name);
  return [...names].sort();
}

export function compareMetrics(before: ScoredRun, after: ScoredRun): MetricComparison[] {
  return metricNames(before, after).map((name) => {
    const left = estimateOf(before, name);
    const right = estimateOf(after, name);
    const paired = pairedValues(before, after, name);
    if (paired) {
      const differences = paired[1].map((value, index) => value - paired[0][index]!);
      const interval = bootstrapMean(differences);
      return {
        name,
        before: left,
        after: right,
        difference: mean(differences),
        ...interval,
        paired: true,
        verdict: verdictFor(interval),
        improved: differences.filter((value) => value > 0).length,
        regressed: differences.filter((value) => value < 0).length,
      };
    }
    const difference = left && right ? right.value - left.value : null;
    return { name, before: left, after: right, difference, low: null, high: null, paired: false, verdict: null, improved: null, regressed: null };
  });
}

export type MetricPair = { before: number; after: number };

export function pairedCaseMetrics(
  before: readonly CaseScore[],
  after: readonly CaseScore[],
  names: readonly string[],
): Map<string, Record<string, MetricPair>> {
  const afterByHash = new Map(after.map((entry) => [entry.inputHash, entry]));
  return new Map(
    before.map((entry) => {
      const other = afterByHash.get(entry.inputHash);
      const pairs = names.flatMap((name) => {
        const left = entry.metrics?.[name];
        const right = other?.metrics?.[name];
        return typeof left === "number" && typeof right === "number" ? [[name, { before: left, after: right }] as const] : [];
      });
      return [entry.inputHash, Object.fromEntries(pairs)];
    }),
  );
}

export type MetricChange = { name: string; improved: number; regressed: number };

export function metricChanges(before: ScoredRun, after: ScoredRun): MetricChange[] {
  const score = compareScores(before.scores, after.scores);
  const paired = compareMetrics(before, after).flatMap((metric) =>
    metric.improved === null || metric.regressed === null ? [] : [{ name: metric.name, improved: metric.improved, regressed: metric.regressed }],
  );
  return [{ name: "score", improved: score.fixed, regressed: score.broken }, ...paired];
}
