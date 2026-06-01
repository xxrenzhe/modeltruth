import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productionAuditEntrypoints = [
  "apps/web/src/app/api/playground/audit/route.ts",
  "apps/worker/src/index.ts",
  "apps/cli/src/index.ts",
  "scripts/live-smoke-gate.ts"
];

describe("audit target rate limit guard", () => {
  it("keeps production audit entrypoints on the default target-host limiter", () => {
    for (const file of productionAuditEntrypoints) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("runSmokeAudit({");
      expect(source, file).not.toContain("requestLimiter");
    }
  });
});
