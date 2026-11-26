"use client";

import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useState } from "react";
import { GITHUB } from "@/lib/content";
import { REPO_API, shownStars, starsFrom } from "@/lib/github-stars";

const CACHE_KEY = "modelstill:github-stars";

function cached(): number | null {
  try {
    const value = sessionStorage.getItem(CACHE_KEY);
    return value === null ? null : starsFrom({ stargazers_count: Number(value) });
  } catch {
    return null;
  }
}

function remember(count: number) {
  try {
    sessionStorage.setItem(CACHE_KEY, String(count));
  } catch {
    return;
  }
}

export function GithubStars({ className }: { className?: string }) {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    const known = cached();
    if (known !== null) {
      setStars(known);
      return;
    }
    const controller = new AbortController();
    fetch(REPO_API, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const count = starsFrom(body);
        if (count === null) return;
        remember(count);
        setStars(count);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const shown = shownStars(stars);
  const label = shown === null ? `Star ${GITHUB.label}` : `Star ${GITHUB.label}, ${shown} stars`;

  return (
    <a
      href={GITHUB.href}
      aria-label={label}
      className={`inline-flex h-9 items-stretch overflow-hidden rounded-[8px] border border-[#3d444d] text-[14px] leading-none font-semibold text-white transition-colors hover:border-[#656c76] ${className ?? ""}`}
    >
      <span className="flex items-center gap-2 bg-[#1f2328] px-3">
        <GithubLogoIcon size={18} weight="fill" aria-hidden="true" />
        <span>Star</span>
      </span>
      {shown === null ? null : (
        <span className="flex items-center border-l border-[#3d444d] bg-black px-3 tabular-nums">{shown}</span>
      )}
    </a>
  );
}
