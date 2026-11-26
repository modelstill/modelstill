import type { ReactNode } from "react";
import { body as redTeaming } from "./ai-red-teaming-tools";
import { body as evalFrameworks } from "./best-open-source-llm-eval-frameworks";
import { body as braintrust } from "./braintrust-alternatives";
import { body as golden } from "./golden-dataset-from-production-traces";
import { body as langfuse } from "./langfuse-alternatives";
import { body as judge } from "./llm-as-a-judge-check-against-people";
import { body as framework } from "./llm-eval-framework-release-decision";
import { body as observability } from "./llm-observability-tools-compared";
import { body as caseStudy } from "./small-model-gate-said-no";

export const POST_BODIES: Record<string, ReactNode> = {
  "best-open-source-llm-eval-frameworks": evalFrameworks,
  "llm-observability-tools-compared": observability,
  "langfuse-alternatives": langfuse,
  "braintrust-alternatives": braintrust,
  "ai-red-teaming-tools": redTeaming,
  "small-model-gate-said-no": caseStudy,
  "llm-as-a-judge-check-against-people": judge,
  "golden-dataset-from-production-traces": golden,
  "llm-eval-framework-release-decision": framework,
};
