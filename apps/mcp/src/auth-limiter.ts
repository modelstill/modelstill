export interface AuthRejectionDecision {
  allowed: boolean;
  retryAfterSec: number;
}

export interface AuthRejectionLimiter {
  reject(key: string): AuthRejectionDecision;
  size(): number;
}

export interface AuthRejectionLimiterOptions {
  limit: number;
  windowMs: number;
  maxClients?: number;
  now?: () => number;
}

interface Window {
  start: number;
  count: number;
}

export function createAuthRejectionLimiter(options: AuthRejectionLimiterOptions): AuthRejectionLimiter {
  const { limit, windowMs, maxClients = 50_000, now = Date.now } = options;
  const windows = new Map<string, Window>();

  function makeRoom(at: number): void {
    for (const [key, window] of windows) if (at - window.start >= windowMs) windows.delete(key);
    if (windows.size >= maxClients) windows.clear();
  }

  return {
    reject(key) {
      if (limit <= 0) return { allowed: true, retryAfterSec: 0 };
      const at = now();
      let window = windows.get(key);
      if (!window || at - window.start >= windowMs) {
        if (!window && windows.size >= maxClients) makeRoom(at);
        window = { start: at, count: 0 };
        windows.set(key, window);
      }
      window.count += 1;
      return {
        allowed: window.count <= limit,
        retryAfterSec: Math.max(1, Math.ceil((window.start + windowMs - at) / 1000)),
      };
    },
    size: () => windows.size,
  };
}

export function clientKeyOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const lastHop = forwarded
    ?.split(",")
    .map((hop) => hop.trim())
    .filter(Boolean)
    .at(-1);
  return lastHop || request.headers.get("x-real-ip")?.trim() || "unknown";
}
