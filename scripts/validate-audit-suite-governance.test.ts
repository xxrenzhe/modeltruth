import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateAuditSuiteGovernance } from "./validate-audit-suite-governance";

describe("validateAuditSuiteGovernance", () => {
  it("passes current audit suite changelog and baseline metadata", () => {
    const result = validateAuditSuiteGovernance(process.cwd());

    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("fails when a registered suite is missing governance metadata", () => {
    const root = mkdtempSync(path.join(tmpdir(), "modeltruth-suite-governance-"));
    mkdirSync(path.join(root, "packages/audit-engine"), { recursive: true });
    writeFileSync(
      path.join(root, "packages/audit-engine/suite-governance.json"),
      JSON.stringify({ schemaVersion: "modeltruth.audit-suite-governance.v1", suites: [] })
    );

    const result = validateAuditSuiteGovernance(root);
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("missing governance record for suite smoke@1.0.0");
  });
});
