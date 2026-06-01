import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react"
    }
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "apps/**/*.test.ts"],
    maxWorkers: 1,
    fileParallelism: false
  },
  resolve: {
    alias: {
      "@modeltruth/db": new URL("./packages/db/src/index.ts", import.meta.url).pathname,
      "@modeltruth/audit-engine": new URL("./packages/audit-engine/src/index.ts", import.meta.url).pathname,
      "@modeltruth/config": new URL("./packages/config/src/index.ts", import.meta.url).pathname,
      "@modeltruth/crypto": new URL("./packages/crypto/src/index.ts", import.meta.url).pathname,
      "@modeltruth/i18n": new URL("./packages/i18n/src/index.ts", import.meta.url).pathname,
      "@modeltruth/seo": new URL("./packages/seo/src/index.ts", import.meta.url).pathname,
      "@modeltruth/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname
    }
  }
});
