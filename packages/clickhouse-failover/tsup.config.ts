import { defineConfig } from "tsup";

export default defineConfig({
  target: "node22",
  outDir: "dist",
  dts: true,
  platform: "node",
  clean: false,
  entry: ["src/index.ts"],
  format: "esm",
});
