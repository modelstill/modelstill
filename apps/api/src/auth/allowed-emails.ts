export function parseAllowedEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function emailAllowed(email: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  const normalized = email.trim().toLowerCase();
  return allowed.some((entry) => (entry.startsWith("@") ? normalized.endsWith(entry) : normalized === entry));
}
