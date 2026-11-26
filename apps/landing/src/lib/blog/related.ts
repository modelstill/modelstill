import type { Post } from "./types";

export const RELATED_COUNT = 3;

function sharedTags(a: Post, b: Post): number {
  return a.tags.filter((tag) => b.tags.includes(tag)).length;
}

export function newestFirst(a: Post, b: Post): number {
  return b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug);
}

export function relatedPosts(post: Post, all: readonly Post[], count: number = RELATED_COUNT): Post[] {
  return all
    .filter((other) => other.slug !== post.slug)
    .map((other) => ({ other, shared: sharedTags(post, other) }))
    .sort((a, b) => b.shared - a.shared || newestFirst(a.other, b.other))
    .slice(0, count)
    .map(({ other }) => other);
}
