import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "modelstill-landing",
    compatibilityDate: "2026-11-01",
    assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "404-page" },
    domains: ["modelstill.com", "www.modelstill.com"],
  },
});
