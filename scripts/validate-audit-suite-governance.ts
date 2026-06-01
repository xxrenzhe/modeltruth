import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { listAuditSuites } from "@modeltruth/audit-engine";

const MAX_OFFICIAL_BASELINE_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

interface SuiteGovernanceFile {
  schemaVersion: string;
  suites: Array<{
    suite: string;
    changelog?: string;
    officialBaseline?: {
      provider?: string;
      modelId?: string;
      recordedAt?: string;
      method?: string;
    };
  }>;
}

export function validateAuditSuiteGovernance(root = process.cwd(), options: { now?: Date } = {}) {
  const issues: string[] = [];
  const now = options.now ?? new Date();
  const filePath = path.join(root, "packages/audit-engine/suite-governance.json");
  if (!existsSync(filePath)) return { ok: false, issues: ["missing packages/audit-engine/suite-governance.json"] };

  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as SuiteGovernanceFile;
  if (parsed.schemaVersion !== "modeltruth.audit-suite-governance.v1") {
    issues.push("suite-governance.json has unsupported schemaVersion");
  }

  const expectedSuites = listAuditSuites().map((suite) => `${suite.suiteId}@${suite.suiteVersion}`).sort();
  const governanceBySuite = new Map(parsed.suites.map((suite) => [suite.suite, suite]));

  for (const suite of expectedSuites) {
    const record = governanceBySuite.get(suite);
    if (!record) {
      issues.push(`missing governance record for suite ${suite}`);
      continue;
    }
    if (!record.changelog || record.changelog.trim().length < 20) {
      issues.push(`suite ${suite} must include a meaningful changelog`);
    }
    const baseline = record.officialBaseline;
    if (!baseline?.provider || !baseline.modelId || !baseline.recordedAt || !baseline.method) {
      issues.push(`suite ${suite} must include official model baseline metadata`);
    } else {
      const baselineTime = Date.parse(baseline.recordedAt);
      if (Number.isNaN(baselineTime)) {
        issues.push(`suite ${suite} has invalid officialBaseline.recordedAt`);
      } else {
        if (baselineTime - now.getTime() > MAX_CLOCK_SKEW_MS) {
          issues.push(`suite ${suite} officialBaseline.recordedAt cannot be in the future`);
        }
        if (now.getTime() - baselineTime > MAX_OFFICIAL_BASELINE_AGE_MS) {
          issues.push(`suite ${suite} officialBaseline.recordedAt must be within 8 days for weekly calibration`);
        }
      }
      const method = baseline.method.toLowerCase();
      if (!method.includes("official") || !method.includes("calibration")) {
        issues.push(`suite ${suite} officialBaseline.method must reference official calibration`);
      }
    }
  }

  for (const suite of governanceBySuite.keys()) {
    if (!expectedSuites.includes(suite)) issues.push(`suite-governance.json references unknown suite ${suite}`);
  }

  return { ok: issues.length === 0, issues };
}

if (process.env.VITEST !== "true") {
  const result = validateAuditSuiteGovernance();
  if (!result.ok) {
    console.error("[validate-audit-suite-governance] failed");
    result.issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }
  console.log("[validate-audit-suite-governance] audit suite changelog and baseline governance passed");
}
