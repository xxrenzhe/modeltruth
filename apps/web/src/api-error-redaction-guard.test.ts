import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function collectApiRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectApiRouteFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("API error redaction guard", () => {
  it("does not directly expose raw Error.message from API routes", () => {
    const apiRouteFiles = collectApiRouteFiles(join("apps/web/src/app/api")).sort();
    expect(apiRouteFiles.length).toBeGreaterThan(0);

    for (const file of apiRouteFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/error instanceof Error\s*\?\s*error\.message/);
      expect(source, file).not.toMatch(/const message = error instanceof Error\s*\?\s*error\.message/);
      if (source.includes("catch (error)")) expect(source, file).toContain("safeErrorMessage");
    }
  });
});
