import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@modeltruth/db": new URL("./packages/db/src/index.ts", import.meta.url).pathname,
      "@modeltruth/audit-engine": new URL("./packages/audit-engine/src/index.ts", import.meta.url).pathname,
      "@modeltruth/crypto": new URL("./packages/crypto/src/index.ts", import.meta.url).pathname
    }
  }
});
