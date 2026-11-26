import { pageCount, pagePosts } from "./pagination";
import { newestFirst } from "./related";
import type { Post } from "./types";

export type { Post } from "./types";

export const POSTS_PER_PAGE = 9;

const REGISTRY: Post[] = [
  {
    slug: "small-model-gate-said-no",
    title: "We tried to replace a cloud model with a small one. The gate said no.",
    description: "Five fine-tuning runs and an open model against a cloud model on 307 gold postings. Every candidate was worse case by case, so the cloud model stayed.",
    date: "2026-11-26",
    tags: ["Case study", "Release gate", "Distillation", "Statistics"],
    keyword: "replace cloud LLM with small model",
    art: { tone: "sun", motif: "intervals" },
  },
  {
    slug: "llm-as-a-judge-check-against-people",
    title: "LLM-as-a-judge: check your judge against people before you trust it",
    description: "How to check an LLM judge before it grades a release: agreement with human labels, Cohen's kappa, false passes, stability and a corrected score.",
    date: "2026-11-25",
    tags: ["Judges", "Evaluation", "Statistics", "Human review"],
    keyword: "LLM as a judge",
    art: { tone: "plum", motif: "scales" },
  },
  {
    slug: "golden-dataset-from-production-traces",
    title: "How to build a golden dataset for LLM evals from production traces",
    description: "Turn logged LLM calls into a versioned golden dataset: two teacher models, human review of disagreements, no leakage into training, then a baseline.",
    date: "2026-11-24",
    tags: ["Datasets", "Evaluation", "Human review"],
    keyword: "golden dataset",
    art: { tone: "sky", motif: "layers" },
  },
  {
    slug: "llm-eval-framework-release-decision",
    title: "What an LLM eval framework should decide, not just measure",
    description: "A score is not a release decision. Compare with a baseline case by case, read intervals, check flip rate, cost and latency, then pass or fail in CI.",
    date: "2026-11-23",
    tags: ["Evaluation", "Release gate", "Statistics"],
    keyword: "LLM eval framework",
    art: { tone: "leaf", motif: "bars" },
  },
];

export const POSTS: Post[] = [...REGISTRY].sort(newestFirst);

export function postBySlug(slug: string): Post | undefined {
  return POSTS.find((post) => post.slug === slug);
}

export function totalBlogPages(): number {
  return pageCount(POSTS.length, POSTS_PER_PAGE);
}

export function postsForPage(page: number): Post[] {
  return pagePosts(POSTS, page, POSTS_PER_PAGE);
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
