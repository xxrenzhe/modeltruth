import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicCopyFiles = [
  "apps/web/src/app/[locale]/compare/[pair]/page.tsx",
  "apps/web/src/app/[locale]/dispute/page.tsx",
  "apps/web/src/app/[locale]/evidence/page.tsx",
  "apps/web/src/app/[locale]/guides/[slug]/page.tsx",
  "apps/web/src/app/[locale]/layout.tsx",
  "apps/web/src/app/[locale]/methodology/page.tsx",
  "apps/web/src/app/[locale]/page.tsx",
  "apps/web/src/app/[locale]/playground/page.tsx",
  "apps/web/src/app/[locale]/pricing/page.tsx",
  "apps/web/src/app/[locale]/privacy/page.tsx",
  "apps/web/src/app/[locale]/providers/[providerSlug]/page.tsx",
  "apps/web/src/app/[locale]/terms/page.tsx",
  "launch/anonymous-baseline-report.md",
  "launch/beta-transparency-changelog.md",
  "launch/blog/01-ai-api-reliability-needs-evidence.md",
  "launch/blog/02-how-we-test-openai-compatible-apis.md",
  "launch/blog/03-why-cli-first-audits-matter.md",
  "launch/faq.md",
  "launch/hacker-news-launch-comment.md",
  "launch/product-hunt-assets.md",
  "packages/i18n/src/index.ts",
  "packages/seo/src/index.ts"
];

const prohibitedPublicTerms = [
  /\bfraud\b/i,
  /\bscam\b/i,
  /\bcriminal\b/i,
  /\bfake\b/i,
  /\bcheat\b/i,
  /\bblacklist\b/i,
  /\bshame\b/i,
  /黑心/,
  /诈骗/
];

describe("public copy legal guard", () => {
  it("keeps public pages free of legally conclusive prohibited terms", () => {
    for (const file of publicCopyFiles) {
      const source = readFileSync(file, "utf8");
      for (const pattern of prohibitedPublicTerms) {
        expect(source, `${file} contains prohibited term ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
