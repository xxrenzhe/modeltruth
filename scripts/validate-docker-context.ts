import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const requiredExcludes = ["docs/", "oldcode/", "secrets/", "claudedocs/", ".git/", "node_modules/", ".next/", "coverage/", ".env", ".env.*"];
const requiredPrograms = ["web", "audit-worker", "scheduler", "notifier"];

export function validateDockerDeployment(root = ".") {
  const problems = [
    ...validateIgnoreFile(`${root}/.dockerignore`, requiredExcludes, ".dockerignore"),
    ...validateIgnoreFile(`${root}/.gitignore`, requiredExcludes.slice(0, 4), ".gitignore"),
    ...validateDockerfile(`${root}/infra/Dockerfile.prod`),
    ...validateGitHubWorkflow(`${root}/.github/workflows/ci.yml`),
    ...validateEntrypoint(`${root}/infra/docker-entrypoint.sh`),
    ...validateSupervisord(`${root}/infra/supervisord.conf`),
    ...validateRuntimeDbInitGuards(root)
  ];
  return { ok: problems.length === 0, problems };
}

function validateGitHubWorkflow(workflowPath: string) {
  if (!existsSync(workflowPath)) return ["missing .github/workflows/ci.yml"];
  const source = readFileSync(workflowPath, "utf8");
  const requiredSnippets = [
    "tags:",
    '"v*"',
    "MODELTRUTH_LIVE_SMOKE_REQUIRED: \"true\"",
    "MODELTRUTH_LIVE_SMOKE_BASE_URL: ${{ secrets.MODELTRUTH_LIVE_SMOKE_BASE_URL }}",
    "MODELTRUTH_LIVE_SMOKE_API_KEY: ${{ secrets.MODELTRUTH_LIVE_SMOKE_API_KEY }}",
    "MODELTRUTH_LIVE_SMOKE_MODEL: ${{ secrets.MODELTRUTH_LIVE_SMOKE_MODEL }}",
    "postgres:16",
    "npm run postgres:migration-smoke",
    "MODELTRUTH_POSTGRES_SMOKE_REQUIRED: \"true\"",
    "MODELTRUTH_POSTGRES_SMOKE_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/modeltruth_ci",
    "docker/build-push-action@v6",
    "ghcr.io/xxrenzhe/bes3:prod-latest",
    "ghcr.io/xxrenzhe/bes3:prod-${{ github.sha }}",
    "ghcr.io/xxrenzhe/bes3:prod-{0}"
  ];
  return requiredSnippets
    .filter((snippet) => !source.includes(snippet))
    .map((snippet) => `ci.yml missing GHCR release requirement: ${snippet}`);
}

function readLines(path: string) {
  return readFileSync(path, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
}

function validateIgnoreFile(path: string, required: string[], label: string) {
  if (!existsSync(path)) return [`missing ${label}`];
  const lines = readLines(path);
  return required.filter((entry) => !lines.includes(entry)).map((entry) => `${label} missing required exclude: ${entry}`);
}

function validateDockerfile(dockerfilePath: string) {
  if (!existsSync(dockerfilePath)) return ["missing infra/Dockerfile.prod"];
  const source = readFileSync(dockerfilePath, "utf8");
  const requiredSnippets = [
    "FROM node:22.22.0-alpine AS deps",
    "RUN npm ci",
    "RUN npm run build",
    "apk add --no-cache supervisor",
    "COPY --from=builder /app/migrations ./migrations",
    "COPY --from=builder /app/pg-migrations ./pg-migrations",
    "USER modeltruth",
    "EXPOSE 80",
    "HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node --import tsx scripts/healthcheck.ts",
    'CMD ["sh", "infra/docker-entrypoint.sh"]'
  ];
  const problems = requiredSnippets.filter((snippet) => !source.includes(snippet)).map((snippet) => `Dockerfile.prod missing: ${snippet}`);
  if (/^USER\s+root\s*$/im.test(source)) problems.push("Dockerfile.prod must not run the production image as root");
  const healthcheckPath = path.join(path.dirname(path.dirname(dockerfilePath)), "scripts", "healthcheck.ts");
  if (!existsSync(healthcheckPath)) {
    problems.push("missing scripts/healthcheck.ts");
  } else if (!readFileSync(healthcheckPath, "utf8").includes("http://127.0.0.1/api/health")) {
    problems.push("healthcheck.ts must probe http://127.0.0.1/api/health");
  }
  return problems;
}

function validateEntrypoint(path: string) {
  if (!existsSync(path)) return ["missing infra/docker-entrypoint.sh"];
  const source = readFileSync(path, "utf8");
  const dbInitIndex = source.indexOf("scripts/db-init.ts");
  const supervisorIndex = source.indexOf("supervisord -c infra/supervisord.conf");
  const problems: string[] = [];
  if (dbInitIndex === -1) problems.push("docker-entrypoint.sh must run scripts/db-init.ts");
  if (supervisorIndex === -1) problems.push("docker-entrypoint.sh must exec supervisord");
  if (dbInitIndex !== -1 && supervisorIndex !== -1 && dbInitIndex > supervisorIndex) {
    problems.push("docker-entrypoint.sh must run db-init before supervisord");
  }
  if (!source.includes("set -e")) problems.push("docker-entrypoint.sh must fail closed with set -e");
  if (!source.includes("SKIP_RUNTIME_DB_INIT=true")) problems.push("docker-entrypoint.sh must set SKIP_RUNTIME_DB_INIT after db-init");
  return problems;
}

function validateSupervisord(path: string) {
  if (!existsSync(path)) return ["missing infra/supervisord.conf"];
  const source = readFileSync(path, "utf8");
  const problems = requiredPrograms
    .filter((program) => !source.includes(`[program:${program}]`))
    .map((program) => `supervisord.conf missing program: ${program}`);
  if (!/PORT=80\b/.test(source)) problems.push("supervisord web program must bind PORT=80");
  if (source.includes("SKIP_RUNTIME_DB_INIT")) {
    problems.push("supervisord.conf must not set SKIP_RUNTIME_DB_INIT; only docker-entrypoint.sh may set it after db-init");
  }
  if (!source.includes("apps/worker/src/index.ts")) problems.push("supervisord must start audit worker");
  if (!source.includes("apps/scheduler/src/index.ts")) problems.push("supervisord must start scheduler");
  if (!source.includes("apps/notifier/src/index.ts")) problems.push("supervisord must start notifier");
  return problems;
}

function validateRuntimeDbInitGuards(root: string) {
  return ["apps/worker/src/index.ts", "apps/scheduler/src/index.ts", "apps/notifier/src/index.ts"].flatMap((relativePath) => {
    const fullPath = `${root}/${relativePath}`;
    if (!existsSync(fullPath)) return [`missing runtime process: ${relativePath}`];
    const source = readFileSync(fullPath, "utf8");
    return source.includes('SKIP_RUNTIME_DB_INIT !== "true"') ? [] : [`${relativePath} must honor SKIP_RUNTIME_DB_INIT`];
  });
}

if (process.env.VITEST !== "true") {
  const result = validateDockerDeployment();
  if (!result.ok) {
    console.error("[validate-docker-context] failed");
    for (const problem of result.problems) console.error(`- ${problem}`);
    process.exit(1);
  }

  console.log("[validate-docker-context] Docker context and single-container runtime topology passed");
}
