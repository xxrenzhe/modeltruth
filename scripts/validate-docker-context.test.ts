import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateDockerDeployment } from "./validate-docker-context";

describe("validateDockerDeployment", () => {
  it("passes for the repository deployment topology", () => {
    expect(validateDockerDeployment().ok).toBe(true);
  });

  it("fails when required single-container runtime pieces are missing", () => {
    const root = mkFixture();
    writeFileSync(path.join(root, ".dockerignore"), "docs/\noldcode/\nsecrets/\nclaudedocs/\n.git/\n");
    writeFileSync(path.join(root, ".gitignore"), "docs/\noldcode/\nsecrets/\nclaudedocs/\n");
    writeFileSync(path.join(root, "infra", "Dockerfile.prod"), "FROM node:22.22.0-alpine AS deps\n");
    writeFileSync(path.join(root, "infra", "docker-entrypoint.sh"), "exec supervisord -c infra/supervisord.conf\n");
    writeFileSync(path.join(root, "infra", "supervisord.conf"), "[program:web]\ncommand=node apps/web/server.js\n");
    mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), "name: CI\n");
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    writeFileSync(path.join(root, "scripts", "healthcheck.ts"), "fetch('http://127.0.0.1:3000/api/health')\n");

    const result = validateDockerDeployment(root);
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "Dockerfile.prod missing: EXPOSE 80",
        "Dockerfile.prod missing: HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node --import tsx scripts/healthcheck.ts",
        "healthcheck.ts must probe http://127.0.0.1/api/health",
        "ci.yml missing GHCR release requirement: ghcr.io/xxrenzhe/bes3:prod-latest",
        'ci.yml missing GHCR release requirement: MODELTRUTH_LIVE_SMOKE_REQUIRED: "true"',
        "ci.yml missing GHCR release requirement: npm run postgres:migration-smoke",
        'ci.yml missing GHCR release requirement: MODELTRUTH_POSTGRES_SMOKE_REQUIRED: "true"',
        "docker-entrypoint.sh must run scripts/db-init.ts",
        "docker-entrypoint.sh must fail closed with set -e",
        "supervisord.conf missing program: audit-worker",
        "supervisord web program must bind PORT=80"
      ])
    );
  });

  it("fails if supervisord tries to bypass entrypoint-owned database initialization", () => {
    const root = mkFixture();
    writeFileSync(path.join(root, ".dockerignore"), "docs/\noldcode/\nsecrets/\nclaudedocs/\n.git/\n");
    writeFileSync(path.join(root, ".gitignore"), "docs/\noldcode/\nsecrets/\nclaudedocs/\n");
    writeFileSync(
      path.join(root, "infra", "Dockerfile.prod"),
      [
        "FROM node:22.22.0-alpine AS deps",
        "RUN npm ci",
        "RUN npm run build",
        "RUN apk add --no-cache supervisor",
        "COPY --from=builder /app/migrations ./migrations",
        "COPY --from=builder /app/pg-migrations ./pg-migrations",
        "EXPOSE 80",
        "HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node --import tsx scripts/healthcheck.ts",
        'CMD ["sh", "infra/docker-entrypoint.sh"]'
      ].join("\n")
    );
    writeFileSync(
      path.join(root, "infra", "docker-entrypoint.sh"),
      "set -e\nnode --import tsx scripts/db-init.ts\nexport SKIP_RUNTIME_DB_INIT=true\nexec supervisord -c infra/supervisord.conf\n"
    );
    writeFileSync(
      path.join(root, "infra", "supervisord.conf"),
      "[program:web]\ncommand=env PORT=80 SKIP_RUNTIME_DB_INIT=true node apps/web/server.js\n[program:audit-worker]\ncommand=node --import tsx apps/worker/src/index.ts\n[program:scheduler]\ncommand=node --import tsx apps/scheduler/src/index.ts\n[program:notifier]\ncommand=node --import tsx apps/notifier/src/index.ts\n"
    );
    mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), githubWorkflowFixture());
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    writeFileSync(path.join(root, "scripts", "healthcheck.ts"), "fetch('http://127.0.0.1/api/health')\n");
    mkdirSync(path.join(root, "apps", "worker", "src"), { recursive: true });
    mkdirSync(path.join(root, "apps", "scheduler", "src"), { recursive: true });
    mkdirSync(path.join(root, "apps", "notifier", "src"), { recursive: true });
    for (const app of ["worker", "scheduler", "notifier"]) {
      writeFileSync(path.join(root, "apps", app, "src", "index.ts"), 'SKIP_RUNTIME_DB_INIT !== "true"\n');
    }

    const result = validateDockerDeployment(root);
    rmSync(root, { recursive: true, force: true });

    expect(result.problems).toContain(
      "supervisord.conf must not set SKIP_RUNTIME_DB_INIT; only docker-entrypoint.sh may set it after db-init"
    );
  });
});

function mkFixture() {
  const root = path.join(tmpdir(), `modeltruth-docker-validate-${crypto.randomUUID()}`);
  mkdirSync(path.join(root, "infra"), { recursive: true });
  return root;
}

function githubWorkflowFixture() {
  return [
    "tags:",
    '"v*"',
    'MODELTRUTH_LIVE_SMOKE_REQUIRED: "true"',
    "MODELTRUTH_LIVE_SMOKE_BASE_URL: ${{ secrets.MODELTRUTH_LIVE_SMOKE_BASE_URL }}",
    "MODELTRUTH_LIVE_SMOKE_API_KEY: ${{ secrets.MODELTRUTH_LIVE_SMOKE_API_KEY }}",
    "MODELTRUTH_LIVE_SMOKE_MODEL: ${{ secrets.MODELTRUTH_LIVE_SMOKE_MODEL }}",
    "postgres:16",
    "npm run postgres:migration-smoke",
    'MODELTRUTH_POSTGRES_SMOKE_REQUIRED: "true"',
    "MODELTRUTH_POSTGRES_SMOKE_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/modeltruth_ci",
    "docker/build-push-action@v6",
    "ghcr.io/xxrenzhe/bes3:prod-latest",
    "ghcr.io/xxrenzhe/bes3:prod-${{ github.sha }}",
    "ghcr.io/xxrenzhe/bes3:prod-{0}"
  ].join("\n");
}
