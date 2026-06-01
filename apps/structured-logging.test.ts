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
        "workspaceId",
        "nodeId",
        "suiteId",
        "suiteVersion",
        "providerHostHash",
        "latencyBreakdown",
        "redactionApplied"
      ]) {
        expect(source, `${file}:${field}`).toContain(field);
      }
      const logCalls = writeJsonLogCalls(source);
      expect(logCalls.length, file).toBeGreaterThan(0);
      for (const logCall of logCalls) {
        expect(logCall, file).not.toMatch(/\b(apiKey|encryptedApiKey|authorization|bearer)\b/i);
        expect(logCall, file).not.toMatch(/\b(originalPayload|payloadJson)\b/);
        expect(logCall, file).not.toMatch(/\bdata\s*:\s*payload\b/);
        expect(logCall, file).not.toMatch(/\.\.\.payload\b/);
        expect(logCall, file).not.toMatch(/\.\.\.input\.payload\b/);
      }
    }
  });
});

function writeJsonLogCalls(source: string) {
  const calls: string[] = [];
  let index = 0;
  while ((index = source.indexOf("writeJsonLog(", index)) >= 0) {
    const end = findCallEnd(source, index + "writeJsonLog(".length);
    calls.push(source.slice(index, end));
    index = end;
  }
  return calls;
}

function findCallEnd(source: string, start: number) {
  let depth = 1;
  let quote: string | undefined;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return index + 1;
  }
  return source.length;
}
