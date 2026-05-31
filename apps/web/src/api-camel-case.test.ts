import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const apiRouteRoot = "apps/web/src/app/api";

describe("API response field naming", () => {
  it("keeps inline JSON response payload keys camelCase", () => {
    for (const file of routeFiles(apiRouteRoot)) {
      const source = readFileSync(file, "utf8");
      for (const payload of nextResponseJsonPayloads(source)) {
        const snakeCaseKeys = [...payload.matchAll(/["']?([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)["']?\s*:/g)].map(
          (match) => match[1]
        );
        expect(snakeCaseKeys, `${file}: ${payload}`).toEqual([]);
      }
    }
  });
});

function routeFiles(root: string): string[] {
  return readdirSync(root)
    .flatMap((entry) => {
      const path = join(root, entry);
      if (statSync(path).isDirectory()) return routeFiles(path);
      return path.endsWith("route.ts") ? [path] : [];
    })
    .sort();
}

function nextResponseJsonPayloads(source: string): string[] {
  const payloads: string[] = [];
  let index = 0;
  while ((index = source.indexOf("NextResponse.json(", index)) >= 0) {
    const start = index + "NextResponse.json(".length;
    payloads.push(firstArgument(source, start));
    index = start;
  }
  return payloads;
}

function firstArgument(source: string, start: number): string {
  let depth = 0;
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
    if (char === "{" || char === "[" || char === "(") depth += 1;
    if (char === "}" || char === "]" || char === ")") {
      if (depth === 0) return source.slice(start, index);
      depth -= 1;
    }
    if (char === "," && depth === 0) return source.slice(start, index);
  }
  return source.slice(start);
}
