import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const clientFilesHandlingApiKeys = [
  "apps/web/src/app/[locale]/playground/playground-client.tsx",
  "apps/web/src/app/[locale]/workspace/workspace-client.tsx"
];

describe("client API key handling guard", () => {
  it("does not persist API keys in browser storage or React state snapshots", () => {
    for (const file of clientFilesHandlingApiKeys) {
      const source = readFileSync(file, "utf8");

      expect(source, file).not.toMatch(/(?:localStorage|sessionStorage|indexedDB)\s*\.[\s\S]{0,120}apiKey/i);
      expect(source, file).not.toMatch(/apiKey[\s\S]{0,120}(?:localStorage|sessionStorage|indexedDB)\s*\./i);
      expect(source, file).not.toMatch(/useState\s*<[^>]*apiKey/i);
      expect(source, file).not.toMatch(/useState\s*\(\s*{[\s\S]{0,160}apiKey/i);
    }
  });
});
