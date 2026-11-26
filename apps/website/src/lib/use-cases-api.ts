"use client";

import { createCasesApi, type CasesApi } from "./cases-api";

let shared: CasesApi | null = null;

function signInAgain() {
  if (window.location.pathname !== "/login") window.location.assign("/login");
}

export function useCasesApi(): CasesApi {
  shared ??= createCasesApi({ onUnauthorized: signInAgain });
  return shared;
}
