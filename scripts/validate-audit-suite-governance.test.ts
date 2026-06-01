import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateAuditSuiteGovernance } from "./validate-audit-suite-governance";

describe("validateAuditSuiteGovernance", () => {
  it("passes current audit suite changelog and baseline metadata", () => {
    const result = validateAuditSuiteGovernance(process.cwd(), { now: new Date("2026-06-01T00:00:00.000Z") });

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

  it("fails stale or non-official suite baselines", () => {
    const root = mkdtempSync(path.join(tmpdir(), "modeltruth-stale-suite-governance-"));
    mkdirSync(path.join(root, "packages/audit-engine"), { recursive: true });
    writeFileSync(
      path.join(root, "packages/audit-engine/suite-governance.json"),
      JSON.stringify({
        schemaVersion: "modeltruth.audit-suite-governance.v1",
        suites: [
          {
            suite: "smoke@1.0.0",
            changelog: "A meaningful suite changelog that describes the release.",
            officialBaseline: {
              provider: "openai",
              modelId: "gpt-5.1",
              recordedAt: "2026-05-20T00:00:00.000Z",
              method: "manual sample"
            }
          },
          governance("reasoning-lite@1.0.0"),
          governance("context-lite@1.0.0"),
          governance("billing-lite@1.0.0"),
          governance("fingerprint-calibration@1.0.0")
        ]
      })
    );

    const result = validateAuditSuiteGovernance(root, { now: new Date("2026-06-01T00:00:00.000Z") });
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("suite smoke@1.0.0 officialBaseline.recordedAt must be within 8 days for weekly calibration");
    expect(result.issues).toContain("suite smoke@1.0.0 officialBaseline.method must reference official calibration");
  });
});

function governance(suite: string) {
  return {
    suite,
    changelog: "A meaningful suite changelog that describes the release.",
    officialBaseline: {
      provider: "openai",
      modelId: "gpt-5.1",
      recordedAt: "2026-05-31T00:00:00.000Z",
      method: "official provider calibration job"
    }
  };
}
