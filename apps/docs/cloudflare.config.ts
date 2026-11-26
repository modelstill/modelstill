import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "modelstill-docs",
    compatibilityDate: "2026-11-01",
    assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "404-page" },
    domains: ["docs.modelstill.com"],
  },
});
