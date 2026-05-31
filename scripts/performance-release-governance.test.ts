import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPerformanceReleaseGovernance } from "./performance-release-governance";

describe("runPerformanceReleaseGovernance", () => {
  it("passes with required build manifests, route coverage and metrics under thresholds", () => {
    const cwd = mkBuildFixture();

    const result = runPerformanceReleaseGovernance({
      cwd,
      maxInitialJsBytes: 20,
      maxRouteJsBytes: 20
    });
    rmSync(cwd, { recursive: true, force: true });

    expect(result.ok).toBe(true);
    expect(result.summary.metricsChecked).toBe(true);
  });

  it("fails when a public route is missing from the build manifest", () => {
    const cwd = mkBuildFixture({ omitRoute: "/[locale]/evidence/page" });

    const result = runPerformanceReleaseGovernance({ cwd });
    rmSync(cwd, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("Public route missing from Next app build manifest: /[locale]/evidence/page");
  });

  it("fails when measured release metrics exceed configured SLOs", () => {
    const cwd = mkBuildFixture();
    writeMetrics(cwd, {
      lcpMs: 3000,
      apiP95Ms: 2000,
      dashboardP95Ms: 400,
      playgroundSmokeP95Ms: 5000,
      dashboardFreshnessSeconds: 60
    });

    const result = runPerformanceReleaseGovernance({ cwd, metricsPath: path.join(cwd, "release-slo-baseline.json") });
    rmSync(cwd, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("LCP 3000ms exceeds 2500ms");
    expect(result.issues).toContain("API P95 2000ms exceeds 1500ms");
  });

  it("fails when mandatory dashboard/playground metrics are absent", () => {
    const cwd = mkBuildFixture();
    writeMetrics(cwd, { lcpMs: 1200, apiP95Ms: 300 });

    const result = runPerformanceReleaseGovernance({ cwd, metricsPath: path.join(cwd, "release-slo-baseline.json") });
    rmSync(cwd, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("Release metrics missing dashboardP95Ms");
    expect(result.issues).toContain("Release metrics missing playgroundSmokeP95Ms");
    expect(result.issues).toContain("Release metrics missing dashboardFreshnessSeconds");
  });

  it("fails when the CLI package points the binary at TypeScript source", () => {
    const cwd = mkBuildFixture({ cliBin: "./src/index.ts" });

    const result = runPerformanceReleaseGovernance({ cwd });
    rmSync(cwd, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("CLI package must expose bundled dist/index.js as the modeltruth binary");
  });
});

function mkBuildFixture(options: { omitRoute?: string; cliBin?: string } = {}) {
  const cwd = path.join(tmpdir(), `modeltruth-release-gate-${crypto.randomUUID()}`);
  const nextDir = path.join(cwd, "apps", "web", ".next");
  const chunksDir = path.join(nextDir, "static", "chunks");
  mkdirSync(chunksDir, { recursive: true });
  writeFileSync(path.join(nextDir, "required-server-files.json"), "{}");
  writeFileSync(path.join(chunksDir, "tiny.js"), "1");
  mkdirSync(path.join(cwd, "apps", "cli"), { recursive: true });
  mkdirSync(path.join(cwd, "apps", "cli", "dist"), { recursive: true });
  mkdirSync(path.join(cwd, "docs", "launch", "assets"), { recursive: true });
  mkdirSync(path.join(cwd, "docs", "launch", "blog"), { recursive: true });
  writeMetrics(path.join(cwd, "docs", "launch"), {
    lcpMs: 1200,
    apiP95Ms: 300,
    dashboardP95Ms: 400,
    playgroundSmokeP95Ms: 5000,
    dashboardFreshnessSeconds: 60
  });
  writeLaunchFixture(cwd);
  writeFileSync(
    path.join(cwd, "apps", "cli", "README.md"),
    [
      "# ModelTruth CLI",
      "## 3-minute quickstart",
      "npm install -g modeltruth-cli",
      "By default it does not upload telemetry.",
      "modeltruth audit --consent-upload true",
      "modeltruth upload --consent true",
      "https://modeltruth.ai/pro"
    ].join("\n")
  );
  writeFileSync(
    path.join(cwd, "apps", "cli", "package.json"),
    JSON.stringify({
      name: "modeltruth-cli",
      version: "0.1.0",
      license: "Apache-2.0",
      private: false,
      bin: { modeltruth: options.cliBin ?? "./dist/index.js" },
      files: ["dist", "README.md"]
    })
  );
  writeFileSync(path.join(cwd, "apps", "cli", "dist", "index.js"), "#!/usr/bin/env node\nconsole.log('modeltruth');\n");

  const routePatterns = [
    "/[locale]/page",
    "/[locale]/playground/page",
    "/[locale]/providers/[providerSlug]/page",
    "/[locale]/methodology/page",
    "/[locale]/pricing/page",
    "/[locale]/privacy/page",
    "/[locale]/settings/privacy/page",
    "/[locale]/terms/page",
    "/[locale]/dispute/page",
    "/[locale]/evidence/page",
    "/[locale]/compare/[pair]/page",
    "/[locale]/guides/[slug]/page",
    "/[locale]/layout"
  ].filter((route) => route !== options.omitRoute);
  const pages = Object.fromEntries(routePatterns.map((route) => [route, ["static/chunks/tiny.js"]]));
  writeFileSync(path.join(nextDir, "app-build-manifest.json"), JSON.stringify({ pages }));
  return cwd;
}

function writeMetrics(cwd: string, metrics: Record<string, number>) {
  writeFileSync(path.join(cwd, "release-slo-baseline.json"), JSON.stringify(metrics));
}

function writeLaunchFixture(cwd: string) {
  const launchDir = path.join(cwd, "docs", "launch");
  writeFileSync(path.join(launchDir, "playground-demo.md"), "Playground demo\n");
  writeFileSync(path.join(launchDir, "product-hunt-assets.md"), "Product Hunt assets\n");
  writeFileSync(path.join(launchDir, "hacker-news-launch-comment.md"), "HN comment\n");
  writeFileSync(path.join(launchDir, "faq.md"), Array.from({ length: 10 }, (_, index) => `## Q${index + 1}\nA`).join("\n"));
  for (const file of ["one.md", "two.md", "three.md"]) writeFileSync(path.join(launchDir, "blog", file), "blog\n");
  for (const file of ["dashboard-screenshot.svg", "playground-demo.svg", "product-hunt-gallery.svg"]) {
    writeFileSync(path.join(launchDir, "assets", file), "<svg />\n");
  }
}
