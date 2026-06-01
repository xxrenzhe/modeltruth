import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const productionRoots = ["apps", "packages", "scripts"];
const allowedSharedScrubberFile = path.normalize("packages/shared/src/index.ts");
const observabilityPattern = /(@sentry|sentry|axiom|@opentelemetry|opentelemetry)/i;
const scrubberPattern = /\b(scrubObservabilityPayload|exportObservabilityPayload)\b/;

describe("observability redaction guard", () => {
  it("requires Sentry, Axiom and OpenTelemetry integrations to use the shared scrubber", () => {
    for (const file of productionSourceFiles()) {
      const normalized = path.normalize(file);
      const source = readFileSync(file, "utf8");
      if (!observabilityPattern.test(source)) continue;
      if (normalized === allowedSharedScrubberFile) continue;

      expect(source, `${file} references an observability sink without the shared redaction helper`).toMatch(scrubberPattern);
    }
  });
});

function productionSourceFiles() {
  const files: string[] = [];
  for (const root of productionRoots) collectFiles(root, files);
  return files.filter(
    (file) =>
      (file.endsWith(".ts") || file.endsWith(".tsx")) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".test.tsx") &&
      !file.includes(`${path.sep}.next${path.sep}`)
  );
}

function collectFiles(currentPath: string, files: string[]) {
  const stats = statSync(currentPath);
  if (stats.isFile()) {
    files.push(currentPath);
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(currentPath)) {
    if (["node_modules", ".next", "dist", "build"].includes(entry)) continue;
    collectFiles(path.join(currentPath, entry), files);
  }
}
