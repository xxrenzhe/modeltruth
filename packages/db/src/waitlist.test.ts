import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createWaitlistRepository } from "./waitlist";

describe("WaitlistRepository", () => {
  it("deduplicates signups by normalized email and maps snake_case rows to camelCase DTOs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-waitlist-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createWaitlistRepository();
    const first = await repo.create({
      email: "Founder@Example.com",
      role: "Founder",
      company: "Example AI",
      source: "homepage"
    });
    const second = await repo.create({ email: "founder@example.com", source: "launch-preview" });
    const signups = await repo.listActive();
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(second.id).toBe(first.id);
    expect(signups).toHaveLength(1);
    expect(signups[0]).toMatchObject({
      email: "founder@example.com",
      role: "Founder",
      company: "Example AI",
      source: "launch-preview",
      status: "active"
    });
    expect(signups[0].createdAt).toEqual(expect.any(String));
    expect(signups[0].updatedAt).toEqual(expect.any(String));
  });
});
