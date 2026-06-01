import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { publicPaths } from "@modeltruth/seo";

type MetricSnapshot = {
  lcpMs?: number;
  apiP95Ms?: number;
  dashboardP95Ms?: number;
  playgroundSmokeP95Ms?: number;
  dashboardFreshnessSeconds?: number;
};

type ReleaseGateOptions = {
  cwd: string;
  maxInitialJsBytes: number;
  maxRouteJsBytes: number;
  maxLcpMs: number;
  maxApiP95Ms: number;
  maxDashboardP95Ms: number;
  maxPlaygroundSmokeP95Ms: number;
  maxDashboardFreshnessSeconds: number;
  metricsPath?: string;
};

type ReleaseGateResult = {
  ok: boolean;
  issues: string[];
  summary: {
    checkedPublicPaths: number;
    maxInitialJsBytes: number;
    maxRouteJsBytes: number;
    metricsChecked: boolean;
  };
};

const defaultOptions: ReleaseGateOptions = {
  cwd: process.cwd(),
  maxInitialJsBytes: Number(process.env.RELEASE_MAX_INITIAL_JS_BYTES ?? 850_000),
  maxRouteJsBytes: Number(process.env.RELEASE_MAX_ROUTE_JS_BYTES ?? 1_200_000),
  maxLcpMs: Number(process.env.RELEASE_MAX_LCP_MS ?? 2500),
  maxApiP95Ms: Number(process.env.RELEASE_MAX_API_P95_MS ?? 1500),
  maxDashboardP95Ms: Number(process.env.RELEASE_MAX_DASHBOARD_P95_MS ?? 1500),
  maxPlaygroundSmokeP95Ms: Number(process.env.RELEASE_MAX_PLAYGROUND_SMOKE_P95_MS ?? 60_000),
  maxDashboardFreshnessSeconds: Number(process.env.RELEASE_MAX_DASHBOARD_FRESHNESS_SECONDS ?? 600),
  metricsPath: process.env.RELEASE_METRICS_PATH ?? "launch/release-slo-baseline.json"
};

export function runPerformanceReleaseGovernance(input: Partial<ReleaseGateOptions> = {}): ReleaseGateResult {
  const options = { ...defaultOptions, ...input };
  const nextDir = path.join(options.cwd, "apps", "web", ".next");
  const appBuildManifestPath = path.join(nextDir, "app-build-manifest.json");
  const requiredServerFilesPath = path.join(nextDir, "required-server-files.json");
  const issues: string[] = [];

  if (!existsSync(appBuildManifestPath)) {
    issues.push("Missing Next app-build-manifest.json. Run npm run build before release governance.");
  }
  if (!existsSync(requiredServerFilesPath)) {
    issues.push("Missing Next standalone required-server-files.json. next.config.mjs must keep output=standalone.");
  }

  const appBuildManifest = existsSync(appBuildManifestPath)
    ? (JSON.parse(readFileSync(appBuildManifestPath, "utf8")) as { pages?: Record<string, string[]> })
    : { pages: {} };
  const pages = appBuildManifest.pages ?? {};
  const routeIssues = validatePublicRouteBuildCoverage(pages);
  issues.push(...routeIssues);
  issues.push(...validateGtmMaterials(options.cwd));

  const rootInitialFiles = pages["/[locale]/layout"] ?? pages["/[locale]/page"] ?? [];
  const initialJsBytes = sumStaticJsBytes(nextDir, rootInitialFiles);
  if (initialJsBytes > options.maxInitialJsBytes) {
    issues.push(`Initial localized JS is ${initialJsBytes} bytes, above ${options.maxInitialJsBytes}`);
  }

  let maxRouteBytes = 0;
  for (const files of Object.values(pages)) {
    maxRouteBytes = Math.max(maxRouteBytes, sumStaticJsBytes(nextDir, files));
  }
  if (maxRouteBytes > options.maxRouteJsBytes) {
    issues.push(`Largest route JS is ${maxRouteBytes} bytes, above ${options.maxRouteJsBytes}`);
  }

  const metrics = readMetrics(options.cwd, options.metricsPath);
  if (metrics) {
    issues.push(...validateMetrics(metrics, options));
  }

  return {
    ok: issues.length === 0,
    issues,
    summary: {
      checkedPublicPaths: publicPaths.length,
      maxInitialJsBytes: initialJsBytes,
      maxRouteJsBytes: maxRouteBytes,
      metricsChecked: Boolean(metrics)
    }
  };
}

function validatePublicRouteBuildCoverage(pages: Record<string, string[]>) {
  const issues: string[] = [];
  const routes = new Set(Object.keys(pages));
  const routePatterns = [
    "/[locale]/page",
    "/[locale]/playground/page",
    "/[locale]/providers/[providerSlug]/page",
    "/[locale]/status/page",
    "/[locale]/methodology/page",
    "/[locale]/pricing/page",
    "/[locale]/privacy/page",
    "/[locale]/settings/privacy/page",
    "/[locale]/terms/page",
    "/[locale]/dispute/page",
    "/[locale]/evidence/page",
    "/[locale]/compare/[pair]/page",
    "/[locale]/guides/[slug]/page"
  ];

  for (const route of routePatterns) {
    if (!routes.has(route)) issues.push(`Public route missing from Next app build manifest: ${route}`);
  }
  return issues;
}

function sumStaticJsBytes(nextDir: string, files: string[]) {
  return files
    .filter((file) => file.endsWith(".js"))
    .reduce((total, file) => {
      const fullPath = path.join(nextDir, file);
      return total + (existsSync(fullPath) ? statSync(fullPath).size : 0);
    }, 0);
}

function readMetrics(cwd: string, metricsPath: string | undefined): MetricSnapshot | null {
  if (!metricsPath) return null;
  const resolvedPath = path.isAbsolute(metricsPath) ? metricsPath : path.join(cwd, metricsPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`release metrics file does not exist: ${resolvedPath}`);
  }
  return JSON.parse(readFileSync(resolvedPath, "utf8")) as MetricSnapshot;
}

function validateMetrics(metrics: MetricSnapshot, options: ReleaseGateOptions) {
  const issues: string[] = [];
  const required = ["dashboardP95Ms", "playgroundSmokeP95Ms", "dashboardFreshnessSeconds"] as const;
  issues.push(...required.filter((key) => metrics[key] === undefined).map((key) => `Release metrics missing ${key}`));
  if (metrics.lcpMs !== undefined && metrics.lcpMs > options.maxLcpMs) {
    issues.push(`LCP ${metrics.lcpMs}ms exceeds ${options.maxLcpMs}ms`);
  }
  if (metrics.apiP95Ms !== undefined && metrics.apiP95Ms > options.maxApiP95Ms) {
    issues.push(`API P95 ${metrics.apiP95Ms}ms exceeds ${options.maxApiP95Ms}ms`);
  }
  if (metrics.dashboardP95Ms !== undefined && metrics.dashboardP95Ms > options.maxDashboardP95Ms) {
    issues.push(`Dashboard P95 ${metrics.dashboardP95Ms}ms exceeds ${options.maxDashboardP95Ms}ms`);
  }
  if (
    metrics.playgroundSmokeP95Ms !== undefined &&
    metrics.playgroundSmokeP95Ms > options.maxPlaygroundSmokeP95Ms
  ) {
    issues.push(`Playground smoke P95 ${metrics.playgroundSmokeP95Ms}ms exceeds ${options.maxPlaygroundSmokeP95Ms}ms`);
  }
  if (
    metrics.dashboardFreshnessSeconds !== undefined &&
    metrics.dashboardFreshnessSeconds > options.maxDashboardFreshnessSeconds
  ) {
    issues.push(
      `Dashboard freshness ${metrics.dashboardFreshnessSeconds}s exceeds ${options.maxDashboardFreshnessSeconds}s`
    );
  }
  return issues;
}

function validateGtmMaterials(cwd: string) {
  return [...validateCliGtmMaterials(cwd), ...validateLaunchMaterials(cwd)];
}

function validateCliGtmMaterials(cwd: string) {
  const cliDir = path.join(cwd, "apps", "cli");
  const packageJsonPath = path.join(cliDir, "package.json");
  const readmePath = path.join(cwd, "apps", "cli", "README.md");
  const issues: string[] = [];
  if (!existsSync(packageJsonPath)) {
    issues.push("Missing apps/cli/package.json for CLI package");
  } else {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string; private?: boolean; bin?: Record<string, string> };
    if (packageJson.name !== "modeltruth-cli") issues.push("CLI package name must be modeltruth-cli");
    if (packageJson.private !== false) issues.push("CLI package must be publishable with private=false");
    if (packageJson.bin?.modeltruth !== "./dist/index.js") issues.push("CLI package must expose bundled dist/index.js as the modeltruth binary");
    issues.push(...validateCliPackContents(cwd, cliDir));
  }

  if (!existsSync(readmePath)) return [...issues, "Missing apps/cli/README.md for CLI quickstart"];
  const readme = readFileSync(readmePath, "utf8");
  const required = [
    "npm install -g modeltruth-cli",
    "3-minute quickstart",
    "does not upload telemetry",
    "--consent-upload true",
    "--consent true",
    "https://modeltruth.ai/pro"
  ];
  issues.push(
    ...required
      .filter((snippet) => !readme.includes(snippet))
      .map((snippet) => `CLI README missing required GTM/privacy snippet: ${snippet}`)
  );
  return issues;
}

function validateCliPackContents(cwd: string, cliDir: string) {
  const issues: string[] = [];
  try {
    const raw = execFileSync("npm", ["--silent", "pack", "--dry-run", "--json"], {
      cwd: cliDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const [pack] = JSON.parse(raw) as Array<{ files?: Array<{ path: string; mode?: number }> }>;
    const files = pack?.files ?? [];
    const filePaths = new Set(files.map((file) => file.path));
    if (!filePaths.has("dist/index.js")) issues.push("CLI npm package must include dist/index.js");
    if (!filePaths.has("README.md")) issues.push("CLI npm package must include README.md");
    if ([...filePaths].some((file) => file.startsWith("src/") || file.endsWith(".ts"))) {
      issues.push("CLI npm package must not ship TypeScript source files");
    }
    const distPath = path.join(cliDir, "dist", "index.js");
    if (!existsSync(distPath)) {
      issues.push("CLI dist/index.js is missing; run npm -w modeltruth-cli run build before release governance");
    } else {
      const dist = readFileSync(distPath, "utf8");
      if (!dist.startsWith("#!/usr/bin/env node")) issues.push("CLI dist/index.js must start with a node shebang");
      if (dist.includes("@modeltruth/")) issues.push("CLI dist/index.js must bundle private @modeltruth workspace packages");
    }
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = `${error instanceof Error ? error.message : String(error)} ${stderr}`.trim();
    issues.push(`CLI npm pack dry-run failed: ${message}`);
  }
  return issues.map((issue) => issue.replaceAll(cwd, "<repo>"));
}

function validateLaunchMaterials(cwd: string) {
  const launchDir = path.join(cwd, "launch");
  const issues: string[] = [];
  const requiredFiles = [
    "playground-demo.md",
    "product-hunt-assets.md",
    "hacker-news-launch-comment.md",
    "faq.md",
    "anonymous-baseline-report.md",
    "beta-transparency-changelog.md",
    "security-incident-response.md"
  ];
  for (const file of requiredFiles) {
    if (!existsSync(path.join(launchDir, file))) issues.push(`Missing launch material: launch/${file}`);
  }
  const faqPath = path.join(launchDir, "faq.md");
  if (existsSync(faqPath)) {
    const faqCount = (readFileSync(faqPath, "utf8").match(/^##\s+/gm) ?? []).length;
    if (faqCount < 10) issues.push(`Launch FAQ must contain at least 10 questions, found ${faqCount}`);
  }
  const blogDir = path.join(launchDir, "blog");
  const blogCount = existsSync(blogDir) ? readdirSync(blogDir).filter((file) => file.endsWith(".md")).length : 0;
  if (blogCount < 3) issues.push(`Launch blog must contain at least 3 posts, found ${blogCount}`);
  for (const asset of ["dashboard-screenshot.svg", "playground-demo.svg", "product-hunt-gallery.svg"]) {
    if (!existsSync(path.join(launchDir, "assets", asset))) issues.push(`Missing launch asset: launch/assets/${asset}`);
  }
  issues.push(...validateLaunchMaterialContent(launchDir));
  return issues;
}

function validateLaunchMaterialContent(launchDir: string) {
  const requiredSnippets: Record<string, string[]> = {
    "anonymous-baseline-report.md": [
      "No raw endpoint path",
      "No request headers",
      "No request body",
      "anonymized audit run summary"
    ],
    "beta-transparency-changelog.md": [
      "CLI telemetry remains off by default",
      "consent=true",
      "48-hour response target",
      "not endorsements or legal conclusions"
    ],
    "security-incident-response.md": [
      "Disable the affected audit path immediately",
      "Notify affected users to rotate keys",
      "structured logs",
      "Publish an initial incident note within 24 hours",
      "regulatory notification duties"
    ]
  };
  return Object.entries(requiredSnippets).flatMap(([file, snippets]) => {
    const fullPath = path.join(launchDir, file);
    if (!existsSync(fullPath)) return [];
    const source = readFileSync(fullPath, "utf8");
    return snippets
      .filter((snippet) => !source.includes(snippet))
      .map((snippet) => `Launch material launch/${file} missing required snippet: ${snippet}`);
  });
}

function main() {
  const result = runPerformanceReleaseGovernance();
  if (!result.ok) {
    console.error("[performance-release-governance] failed");
    result.issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }

  console.log(
    `[performance-release-governance] passed: publicPaths=${result.summary.checkedPublicPaths}, ` +
      `initialJs=${result.summary.maxInitialJsBytes}, maxRouteJs=${result.summary.maxRouteJsBytes}, ` +
      `metricsChecked=${result.summary.metricsChecked}`
  );
}

if (process.env.VITEST !== "true") {
  main();
}
