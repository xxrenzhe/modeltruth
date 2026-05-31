import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtimeFiles = ["apps/scheduler/src/index.ts", "apps/worker/src/index.ts", "apps/notifier/src/index.ts"];

describe("runtime structured logging guard", () => {
  it("keeps long-running services on JSON-line logger instead of raw console output", () => {
    for (const file of runtimeFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("writeJsonLog");
      expect(source, file).not.toMatch(/console\.(log|warn|error)\(/);
    }
  });

  it("records required audit observability fields without raw key material", () => {
    for (const file of ["apps/worker/src/index.ts", "apps/web/src/app/api/playground/audit/route.ts"]) {
      const source = readFileSync(file, "utf8");
      for (const field of [
        "traceId",
        "runId",
        "suiteId",
        "suiteVersion",
        "providerHostHash",
        "latencyBreakdown",
        "redactionApplied"
      ]) {
        expect(source, `${file}:${field}`).toContain(field);
      }
      const logCalls = source.match(/writeJsonLog\([\s\S]*?\);/g) ?? [];
      expect(logCalls.length, file).toBeGreaterThan(0);
      for (const logCall of logCalls) {
        expect(logCall, file).not.toMatch(/\b(apiKey|encryptedApiKey|authorization|bearer)\b/i);
      }
    }
  });
});
