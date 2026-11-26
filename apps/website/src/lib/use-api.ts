"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient, type ApiClient } from "./api";

let shared: ApiClient | null = null;

function signInAgain() {
  if (window.location.pathname !== "/login") window.location.assign("/login");
}

export function useApiClient(): ApiClient {
  shared ??= createApiClient({ onUnauthorized: signInAgain });
  return shared;
}

export type Resource<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; data: T };

export type LoadedResource<T> = Resource<T> & { reload: () => void; refresh: () => void };

export function useResource<T>(load: (api: ApiClient) => Promise<T>, key: readonly unknown[]): LoadedResource<T> {
  const api = useApiClient();
  const [state, setState] = useState<Resource<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const serialized = JSON.stringify(key);

  useEffect(() => {
    const current = ++generation.current;
    setState({ status: "loading" });
    latestLoad.current(api).then(
      (data) => current === generation.current && setState({ status: "ready", data }),
      (error: unknown) =>
        current === generation.current && setState({ status: "error", error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      generation.current += 1;
    };
  }, [api, serialized, attempt]);

  const refresh = useCallback(() => {
    const current = generation.current;
    latestLoad.current(api).then(
      (data) => current === generation.current && setState({ status: "ready", data }),
      () => undefined,
    );
  }, [api]);

  return { ...state, reload, refresh };
}

export function usePolling(tick: () => void, everyMs: number, active: boolean): void {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    if (!active || everyMs <= 0) return;
    const timer = setInterval(() => latest.current(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
}
