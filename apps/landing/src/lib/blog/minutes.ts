import { POST_BODIES } from "./bodies";
import { readingMinutes, treeText } from "./reading-time";

export function postMinutes(slug: string): number {
  return readingMinutes(treeText(POST_BODIES[slug]));
}
