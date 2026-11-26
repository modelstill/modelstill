import type { ReactNode } from "react";
import { body as golden } from "./golden-dataset-from-production-traces";
import { body as judge } from "./llm-as-a-judge-check-against-people";
import { body as framework } from "./llm-eval-framework-release-decision";
import { body as caseStudy } from "./small-model-gate-said-no";

export const POST_BODIES: Record<string, ReactNode> = {
  "small-model-gate-said-no": caseStudy,
  "llm-as-a-judge-check-against-people": judge,
  "golden-dataset-from-production-traces": golden,
  "llm-eval-framework-release-decision": framework,
};
