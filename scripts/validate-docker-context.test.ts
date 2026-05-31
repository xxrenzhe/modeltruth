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
    writeFileSync(path.join(root, "infra", "Dockerfile.prod"), "FROM node:22-alpine AS deps\n");
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
        "docker-entrypoint.sh must run scripts/db-init.ts",
        "docker-entrypoint.sh must fail closed with set -e",
        "supervisord.conf missing program: audit-worker",
        "supervisord web program must bind PORT=80"
      ])
    );
  });
});

function mkFixture() {
  const root = path.join(tmpdir(), `modeltruth-docker-validate-${crypto.randomUUID()}`);
  mkdirSync(path.join(root, "infra"), { recursive: true });
  return root;
}
