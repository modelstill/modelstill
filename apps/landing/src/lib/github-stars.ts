export const REPO_API = "https://api.github.com/repos/modelstill/modelstill";

export function starsFrom(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const count = (body as { stargazers_count?: unknown }).stargazers_count;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

export function formatStars(count: number): string {
  return count.toLocaleString("en-US");
}

export function shownStars(count: number | null): string | null {
  return count === null || count < 1 ? null : formatStars(count);
}
