import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const publicCopyRoots = [
  "apps/web/src/app/[locale]",
  "launch",
  "packages/i18n/src",
  "packages/seo/src"
];

const publicCopyExtensions = new Set([".md", ".svg", ".ts", ".tsx"]);

const prohibitedPublicTerms = [
  /\bfraud\b/i,
  /\bscam\b/i,
  /\bcriminal\b/i,
  /\bfake\b/i,
  /\bblacklist\b/i,
  /\bshame\b/i,
  /黑心/,
  /诈骗/,
  /欺诈/,
  /骗子/,
  /耻辱柱/,
  /定罪/
];

describe("public copy legal guard", () => {
  it("dynamically covers public route, launch, i18n and SEO copy files", () => {
    const publicCopyFiles = collectPublicCopyFiles();
    expect(publicCopyFiles).toEqual(
      expect.arrayContaining([
        "apps/web/src/app/[locale]/login/page.tsx",
        "apps/web/src/app/[locale]/settings/privacy/page.tsx",
        "apps/web/src/app/[locale]/workspace/workspace-client.tsx",
        "launch/playground-demo.md",
        "launch/assets/playground-demo.svg",
        "packages/i18n/src/index.ts",
        "packages/seo/src/generateMetadata.ts"
      ])
    );
  });

  it("keeps public pages free of legally conclusive prohibited terms", () => {
    for (const file of collectPublicCopyFiles()) {
      const source = readFileSync(file, "utf8");
      for (const pattern of prohibitedPublicTerms) {
        expect(source, `${file} contains prohibited term ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

function collectPublicCopyFiles() {
  return publicCopyRoots.flatMap((root) => collectFiles(root)).sort();
}

function collectFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (publicCopyExtensions.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}
