import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const allowedLicenses = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unlicense"]);

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
};

export function validateThirdPartyNotices(root = process.cwd()) {
  const rootPackage = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as PackageJson;
  const notices = readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf-8");
  const noticeRows = parseNoticeRows(notices);
  const problems = collectPinnedVersionProblems(rootPackage);

  const directDependencies = [
    ...Object.keys(rootPackage.dependencies ?? {}),
    ...Object.keys(rootPackage.devDependencies ?? {})
  ].filter((name) => !name.startsWith("@modeltruth/"));

  for (const dependency of directDependencies.sort()) {
    const pkg = JSON.parse(readFileSync(path.join(root, "node_modules", dependency, "package.json"), "utf-8")) as {
      version?: string;
      license?: string;
    };
    const license = pkg.license ?? "UNKNOWN";
    const notice = noticeRows.get(dependency);
    if (!notice) {
      problems.push(`${dependency} is missing from THIRD_PARTY_NOTICES.md`);
    } else {
      if (notice.version !== pkg.version) {
        problems.push(`${dependency} notice version ${notice.version} does not match installed version ${pkg.version ?? "unknown"}`);
      }
      if (notice.license !== license) {
        problems.push(`${dependency} notice license ${notice.license} does not match installed license ${license}`);
      }
    }
    if (!allowedLicenses.has(license)) {
      problems.push(`${dependency}@${pkg.version ?? "unknown"} uses unsupported license ${license}`);
    }
  }

  return {
    ok: problems.length === 0,
    directDependencies,
    problems
  };
}

export function parseNoticeRows(notices: string) {
  const rows = new Map<string, { version: string; license: string }>();
  for (const line of notices.split(/\r?\n/)) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!match) continue;
    rows.set(match[1], { version: match[2].trim(), license: match[3].trim() });
  }
  return rows;
}

export function collectPinnedVersionProblems(rootPackage: PackageJson) {
  const problems: string[] = [];
  const declaredVersions = [
    ...Object.entries(rootPackage.dependencies ?? {}),
    ...Object.entries(rootPackage.devDependencies ?? {}),
    ...collectOverrideVersionEntries(rootPackage.overrides ?? {})
  ];

  for (const [dependency, version] of declaredVersions.sort(([left], [right]) => left.localeCompare(right))) {
    if (!isPinnedSemver(version)) {
      problems.push(`${dependency} must use an exact pinned semver version, found ${version}`);
    }
  }

  return problems;
}

function collectOverrideVersionEntries(overrides: Record<string, unknown>, prefix = "overrides"): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [dependency, value] of Object.entries(overrides)) {
    const name = `${prefix}.${dependency}`;
    if (typeof value === "string") {
      entries.push([name, value]);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      entries.push(...collectOverrideVersionEntries(value as Record<string, unknown>, name));
    }
  }
  return entries;
}

export function isPinnedSemver(value: string) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  const result = validateThirdPartyNotices();
  if (result.problems.length > 0) {
    console.error("[validate-third-party-notices] failed");
    for (const problem of result.problems) console.error(`- ${problem}`);
    process.exit(1);
  }

  console.log(`[validate-third-party-notices] ${result.directDependencies.length} direct dependencies are documented`);
}
