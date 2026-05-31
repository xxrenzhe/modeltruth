import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

type EngineeringDisciplineOptions = {
  root: string;
  maxLines?: number;
};

type EngineeringDisciplineResult = {
  ok: boolean;
  problems: string[];
};

type PlanNamedArtifact = {
  path: string;
  snippets: string[];
  implementationPath?: string;
};

const sourceExtensions = new Set([".ts", ".tsx"]);
const ignoredSegments = new Set(["node_modules", ".next", "dist", "coverage"]);
const ddlPattern = /\b(create\s+table|alter\s+table|drop\s+table|drop\s+column|truncate)\b/i;
const ddlAllowedPathPatterns = [
  /^packages\/db\/src\/index\.ts$/,
  /\.test\.ts$/,
  /^scripts\/(db-init|migrate|validate-db-schema|final-migration-check)\.ts$/,
  /^scripts\/validate-engineering-discipline\.ts$/
];

export function validateEngineeringDiscipline(options: EngineeringDisciplineOptions): EngineeringDisciplineResult {
  const maxLines = options.maxLines ?? 500;
  const files = listSourceFiles(options.root);
  const problems = [
    ...validateLineCounts(options.root, files, maxLines),
    ...validateNoBusinessPathDdl(options.root, files),
    ...validateStartupDbInit(options.root),
    ...validateDatabaseLifecycleImplementation(options.root),
    ...validatePlanNamedArtifacts(options.root)
  ];
  return { ok: problems.length === 0, problems };
}

function listSourceFiles(root: string) {
  const dirs = ["apps", "packages", "scripts"].map((dir) => path.join(root, dir)).filter(existsSync);
  return dirs.flatMap((dir) => walk(dir)).filter((file) => sourceExtensions.has(path.extname(file)));
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (ignoredSegments.has(entry)) return [];
    if (statSync(fullPath).isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

function validateLineCounts(root: string, files: string[], maxLines: number) {
  return files.flatMap((file) => {
    const lineCount = readFileSync(file, "utf8").split(/\r?\n/).length;
    return lineCount > maxLines ? [`${relative(root, file)} has ${lineCount} lines, above ${maxLines}`] : [];
  });
}

function validateNoBusinessPathDdl(root: string, files: string[]) {
  return files.flatMap((file) => {
    const relativePath = relative(root, file);
    if (ddlAllowedPathPatterns.some((pattern) => pattern.test(relativePath))) return [];
    const source = readFileSync(file, "utf8");
    return ddlPattern.test(source) ? [`${relativePath} contains schema-changing SQL outside migration tooling`] : [];
  });
}

function validateStartupDbInit(root: string) {
  const packageJsonPath = path.join(root, "package.json");
  if (!existsSync(packageJsonPath)) return ["missing root package.json"];
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  const requiredScripts = ["dev", "build", "start"];
  const problems = requiredScripts.flatMap((scriptName) => {
    const command = scripts[scriptName] ?? "";
    return command.includes("npm run db:init")
      ? []
      : [`package.json script "${scriptName}" must run db:init before starting application code`];
  });
  return [...problems, ...validateWebWorkspaceStartup(root)];
}

function validateWebWorkspaceStartup(root: string) {
  const packageJsonPath = path.join(root, "apps", "web", "package.json");
  if (!existsSync(packageJsonPath)) return ["missing apps/web/package.json"];
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  const startCommand = packageJson.scripts?.start ?? "";
  return startCommand.includes("run db:init")
    ? []
    : ['apps/web package.json script "start" must run root db:init before next start'];
}

function validateDatabaseLifecycleImplementation(root: string) {
  const dbIndexPath = path.join(root, "packages", "db", "src", "index.ts");
  const dbInitPath = path.join(root, "scripts", "db-init.ts");
  const migratePath = path.join(root, "scripts", "migrate.ts");
  const problems: string[] = [];

  if (!existsSync(dbIndexPath)) return ["missing packages/db/src/index.ts"];
  const dbSource = readFileSync(dbIndexPath, "utf8");
  const requiredDbSnippets = [
    "ensurePostgresDatabaseExists",
    "create database",
    "path.join(options.cwd, \"migrations\")",
    "path.join(options.cwd, \"pg-migrations\")",
    "migration_history",
    "file_hash",
    "status",
    "failed_at",
    "last_error",
    "pg_try_advisory_lock",
    "set local lock_timeout",
    "set local statement_timeout"
  ];
  for (const snippet of requiredDbSnippets) {
    if (!dbSource.includes(snippet)) problems.push(`database lifecycle implementation missing: ${snippet}`);
  }

  if (!existsSync(dbInitPath) || !readFileSync(dbInitPath, "utf8").includes("ensureDatabaseReady")) {
    problems.push("scripts/db-init.ts must call ensureDatabaseReady");
  }
  if (!existsSync(migratePath) || !readFileSync(migratePath, "utf8").includes("ensureDatabaseReady")) {
    problems.push("scripts/migrate.ts must use the same startup migration executor");
  }

  return problems;
}

function validatePlanNamedArtifacts(root: string) {
  const requiredArtifacts: PlanNamedArtifact[] = [
    {
      path: "packages/seo/generateMetadata.ts",
      snippets: ["buildSeoMetadata", "languageAlternates", "jsonLdScript"],
      implementationPath: "packages/seo/src/generateMetadata.ts"
    },
    {
      path: "packages/audit-engine/src/model-pricing.ts",
      snippets: ["modelPricingTable", "estimateModelCost", "inputUsdPerMillionTokens"]
    }
  ];

  return requiredArtifacts.flatMap((artifact) => {
    const fullPath = path.join(root, artifact.path);
    if (!existsSync(fullPath)) return [`missing docs/plan named artifact: ${artifact.path}`];
    const source = readFileSync(fullPath, "utf8");
    const implementationSource = artifact.implementationPath
      ? readDelegatedImplementation(root, artifact, source)
      : undefined;
    return artifact.snippets
      .filter((snippet) => !source.includes(snippet) && !implementationSource?.includes(snippet))
      .map((snippet) => `${artifact.path} missing required implementation snippet: ${snippet}`);
  });
}

function readDelegatedImplementation(root: string, artifact: PlanNamedArtifact, artifactSource: string) {
  if (!artifact.implementationPath) return undefined;
  const normalizedImplementation = `./${path.relative(path.dirname(artifact.path), artifact.implementationPath).replaceAll(path.sep, "/").replace(/\.ts$/, "")}`;
  if (!artifactSource.includes(`from "${normalizedImplementation}"`) && !artifactSource.includes(`from '${normalizedImplementation}'`)) {
    return undefined;
  }
  const implementationFullPath = path.join(root, artifact.implementationPath);
  return existsSync(implementationFullPath) ? readFileSync(implementationFullPath, "utf8") : undefined;
}

function relative(root: string, file: string) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

if (process.env.VITEST !== "true") {
  const result = validateEngineeringDiscipline({ root: process.cwd() });
  if (!result.ok) {
    console.error("[validate-engineering-discipline] failed");
    result.problems.forEach((problem) => console.error(`- ${problem}`));
    process.exit(1);
  }
  console.log("[validate-engineering-discipline] source file size and DB change discipline passed");
}
