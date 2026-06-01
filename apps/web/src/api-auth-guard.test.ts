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
const publicRoutes = new Set([
  "auth/logout/route.ts",
  "auth/magic-link/route.ts",
  "auth/session/route.ts",
  "auth/verify/route.ts",
  "disputes/route.ts",
  "gtm/visit/route.ts",
  "health/route.ts",
  "playground/audit/route.ts",
  "providers/subscribe/route.ts",
  "providers/unsubscribe/route.ts",
  "waitlist/route.ts"
]);
const protectionPatterns = [
  /getCurrentSession\(/,
  /verifyStripeWebhook\(/,
  /MODELTRUTH_GTM_METRICS_TOKEN/,
  /authorization["']\)\?\.match\(\^Bearer/,
  /token\.startsWith\("mtp_"\)/
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

  it("requires every non-public API route to declare an authentication mechanism", () => {
    const unprotected = routeFiles()
      .map((file) => ({ file, route: apiRouteName(file), source: readFileSync(file, "utf-8") }))
      .filter(({ route }) => !publicRoutes.has(route))
      .filter(({ source }) => !protectionPatterns.some((pattern) => pattern.test(source)))
      .map(({ route }) => route);

    expect(unprotected).toEqual([]);
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

function apiRouteName(file: string) {
  return normalizePath(path.relative(apiRoot, file));
}
