import { defineConfig } from "vitest/config";

/** Explicitly isolated: default `npm test` cannot discover a real Playwright probe. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/contracts/playwright/**/*.probe.ts"],
  },
});
