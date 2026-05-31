import { readFileSync } from "node:fs";
import path from "node:path";

const allowedLicenses = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unlicense"]);
const root = process.cwd();
const rootPackage = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const notices = readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf-8");

const directDependencies = [
  ...Object.keys(rootPackage.dependencies ?? {}),
  ...Object.keys(rootPackage.devDependencies ?? {})
].filter((name) => !name.startsWith("@modeltruth/"));

const problems: string[] = [];

for (const dependency of directDependencies.sort()) {
  const pkg = JSON.parse(readFileSync(path.join(root, "node_modules", dependency, "package.json"), "utf-8")) as {
    version?: string;
    license?: string;
  };
  const license = pkg.license ?? "UNKNOWN";
  if (!notices.includes(`\`${dependency}\``)) {
    problems.push(`${dependency} is missing from THIRD_PARTY_NOTICES.md`);
  }
  if (!allowedLicenses.has(license)) {
    problems.push(`${dependency}@${pkg.version ?? "unknown"} uses unsupported license ${license}`);
  }
}

if (problems.length > 0) {
  console.error("[validate-third-party-notices] failed");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`[validate-third-party-notices] ${directDependencies.length} direct dependencies are documented`);
