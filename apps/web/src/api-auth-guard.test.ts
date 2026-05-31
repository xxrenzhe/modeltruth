import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = path.join(process.cwd(), "apps/web/src/app/api");
const protectedRouteFragments = [
  "/billing/",
  "/cli/",
  "/disputes/",
  "/evidence/",
  "/reports/",
  "/settings/privacy/",
  "/workspace/"
];

describe("API auth guard static rules", () => {
  it("does not allow business API routes to trust spoofable user headers", () => {
    const violations = routeFiles()
      .map((file) => ({ file, source: readFileSync(file, "utf-8") }))
      .filter(({ file }) => protectedRouteFragments.some((fragment) => normalizePath(file).includes(fragment)))
      .filter(({ source }) => /\bx-user-id\b/i.test(source) || /\bx-workspace-id\b/i.test(source))
      .map(({ file }) => path.relative(process.cwd(), file));

    expect(violations).toEqual([]);
  });
});

function routeFiles(directory = apiRoot): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) return routeFiles(absolute);
    return entry === "route.ts" ? [absolute] : [];
  });
}

function normalizePath(file: string) {
  return file.split(path.sep).join("/");
}
