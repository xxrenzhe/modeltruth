import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateEngineeringDiscipline } from "./validate-engineering-discipline";

describe("validateEngineeringDiscipline", () => {
  it("passes for the repository source tree", () => {
    expect(validateEngineeringDiscipline({ root: process.cwd() }).ok).toBe(true);
  });

  it("fails files above the line budget", () => {
    const root = mkFixture();
    writeFileSync(path.join(root, "apps", "web", "src", "large.ts"), Array.from({ length: 6 }, (_, index) => `line${index}`).join("\n"));

    const result = validateEngineeringDiscipline({ root, maxLines: 5 });
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("apps/web/src/large.ts has 6 lines, above 5");
  });

  it("fails business-path schema changes while allowing migration tooling", () => {
    const root = mkFixture();
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "npm run db:init && next dev", build: "npm run db:init && next build", start: "npm run db:init && next start" } }));
    writeFileSync(path.join(root, "apps", "web", "src", "route.ts"), "export const sql = `create table unsafe (id text)`;");
    mkdirSync(path.join(root, "packages", "db", "src"), { recursive: true });
    writeFileSync(path.join(root, "packages", "db", "src", "index.ts"), "const sql = `create table migration_history (id text)`;");

    const result = validateEngineeringDiscipline({ root });
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("apps/web/src/route.ts contains schema-changing SQL outside migration tooling");
  });

  it("fails when application startup scripts can bypass db:init", () => {
    const root = mkFixture();
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "npm run db:init && next dev", build: "npm run db:init && next build", start: "next start" } }));

    const result = validateEngineeringDiscipline({ root });
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain('package.json script "start" must run db:init before starting application code');
  });

  it("fails when the web workspace start script bypasses root db:init", () => {
    const root = mkFixture();
    writeFileSync(path.join(root, "apps", "web", "package.json"), JSON.stringify({ scripts: { start: "next start" } }));

    const result = validateEngineeringDiscipline({ root });
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain('apps/web package.json script "start" must run root db:init before next start');
  });

  it("fails when database lifecycle implementation drops startup migration guarantees", () => {
    const root = mkFixture();
    mkdirSync(path.join(root, "packages", "db", "src"), { recursive: true });
    writeFileSync(path.join(root, "packages", "db", "src", "index.ts"), "export function ensureDatabaseReady() {}");
    writeFileSync(path.join(root, "scripts", "db-init.ts"), "import { ensureDatabaseReady } from '@modeltruth/db'; ensureDatabaseReady();");
    writeFileSync(path.join(root, "scripts", "migrate.ts"), "import { ensureDatabaseReady } from '@modeltruth/db'; ensureDatabaseReady();");

    const result = validateEngineeringDiscipline({ root });
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("database lifecycle implementation missing: ensurePostgresDatabaseExists");
    expect(result.problems).toContain("database lifecycle implementation missing: pg_try_advisory_lock");
  });

  it("fails when docs/plan named architecture artifacts are missing", () => {
    const root = mkFixture({ includePlanArtifacts: false });

    const result = validateEngineeringDiscipline({ root });
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.problems).toContain("missing docs/plan named artifact: packages/seo/generateMetadata.ts");
    expect(result.problems).toContain("missing docs/plan named artifact: packages/audit-engine/src/model-pricing.ts");
  });

  it("accepts docs/plan named artifacts that delegate to src implementations", () => {
    const root = mkFixture({ includePlanArtifacts: false });
    writeFileSync(path.join(root, "packages", "seo", "generateMetadata.ts"), 'export * from "./src/generateMetadata";');
    writeFileSync(
      path.join(root, "packages", "seo", "src", "generateMetadata.ts"),
      "export const buildSeoMetadata = true; export const languageAlternates = true; export const jsonLdScript = true;"
    );
    writeFileSync(
      path.join(root, "packages", "audit-engine", "src", "model-pricing.ts"),
      "export const modelPricingTable = []; export const estimateModelCost = true; export const inputUsdPerMillionTokens = true;"
    );

    const result = validateEngineeringDiscipline({ root });
    rmSync(root, { recursive: true, force: true });

    expect(result.problems).not.toContain("packages/seo/generateMetadata.ts missing required implementation snippet: buildSeoMetadata");
    expect(result.ok).toBe(true);
  });
});

function mkFixture(options: { includePlanArtifacts?: boolean } = {}) {
  const root = path.join(tmpdir(), `modeltruth-engineering-discipline-${crypto.randomUUID()}`);
  mkdirSync(path.join(root, "apps", "web", "src"), { recursive: true });
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, "packages", "db", "src"), { recursive: true });
  mkdirSync(path.join(root, "packages", "seo", "src"), { recursive: true });
  mkdirSync(path.join(root, "packages", "audit-engine", "src"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "npm run db:init && next dev", build: "npm run db:init && next build", start: "npm run db:init && next start" } }));
  writeFileSync(path.join(root, "apps", "web", "package.json"), JSON.stringify({ scripts: { start: "npm --prefix ../.. run db:init && next start" } }));
  writeFileSync(
    path.join(root, "packages", "db", "src", "index.ts"),
    [
      "function ensurePostgresDatabaseExists() {}",
      "const ddl = 'create database';",
      "const sqliteDir = path.join(options.cwd, \"migrations\");",
      "const pgDir = path.join(options.cwd, \"pg-migrations\");",
      "const history = 'migration_history file_hash status failed_at last_error';",
      "const lock = 'pg_try_advisory_lock set local lock_timeout set local statement_timeout';"
    ].join("\n")
  );
  writeFileSync(path.join(root, "scripts", "db-init.ts"), "import { ensureDatabaseReady } from '@modeltruth/db'; ensureDatabaseReady();");
  writeFileSync(path.join(root, "scripts", "migrate.ts"), "import { ensureDatabaseReady } from '@modeltruth/db'; ensureDatabaseReady();");
  if (options.includePlanArtifacts !== false) {
    writeFileSync(
      path.join(root, "packages", "seo", "generateMetadata.ts"),
      "export const buildSeoMetadata = true; export const languageAlternates = true; export const jsonLdScript = true;"
    );
    writeFileSync(
      path.join(root, "packages", "audit-engine", "src", "model-pricing.ts"),
      "export const modelPricingTable = []; export const estimateModelCost = true; export const inputUsdPerMillionTokens = true;"
    );
  }
  return root;
}
