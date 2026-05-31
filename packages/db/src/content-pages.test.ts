import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createContentPageRepository } from "./content-pages";
import { ensureSqliteReady } from "./index";

describe("ContentPageRepository", () => {
  it("upserts localized SEO content pages with camelCase DTOs and noIndex filtering", async () => {
    const harness = await createHarness();
    const repo = await createContentPageRepository();
    try {
      const english = await repo.upsert({
        locale: "en",
        type: "guide",
        slug: "how-to-test-openai-compatible-api",
        title: "How to test an OpenAI-compatible API",
        description: "A technical audit guide for AI API endpoints.",
        bodyMarkdown: "# Guide",
        seoTitle: "Test OpenAI-compatible APIs",
        seoDescription: "Verify uptime, latency, model consistency and billing.",
        canonicalSlug: "how-to-test-openai-compatible-api"
      });
      const chineseDraft = await repo.upsert({
        locale: "zh-CN",
        type: "guide",
        slug: "how-to-test-openai-compatible-api",
        title: "如何测试 OpenAI-compatible API",
        description: "中文草稿。",
        bodyMarkdown: "# 草稿",
        canonicalSlug: "how-to-test-openai-compatible-api",
        noIndex: true
      });
      const updated = await repo.upsert({
        locale: "en",
        type: "guide",
        slug: "how-to-test-openai-compatible-api",
        title: "Updated guide",
        description: "Updated description.",
        bodyMarkdown: "# Updated"
      });
      const publishedEnglish = await repo.listPublished("en", "guide");
      const publishedChinese = await repo.listPublished("zh-CN", "guide");

      expect(updated.id).toBe(english.id);
      expect(updated).toMatchObject({
        bodyMarkdown: "# Updated",
        noIndex: false,
        publishedAt: expect.any(String)
      });
      expect(chineseDraft.noIndex).toBe(true);
      expect(publishedEnglish.map((page) => page.slug)).toEqual(["how-to-test-openai-compatible-api"]);
      expect(publishedChinese).toEqual([]);
      expect(JSON.stringify(updated)).not.toContain("body_markdown");
      expect(JSON.stringify(updated)).not.toContain("no_index");
    } finally {
      await repo.close();
      harness.cleanup();
    }
  });
});

async function createHarness() {
  const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-content-pages-"));
  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  return {
    cleanup() {
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
