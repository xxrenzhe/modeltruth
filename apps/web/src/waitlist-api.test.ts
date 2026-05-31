import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWaitlistRepository, ensureSqliteReady } from "@modeltruth/db";
import { POST } from "./app/api/waitlist/route";

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("waitlist API", () => {
  afterEach(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("accepts form signups without returning the email address", async () => {
    await setupDatabase();
    const response = await POST(
      new Request("http://localhost/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          email: "Founder@Example.com",
          role: "AI founder",
          company: "Example AI",
          source: "homepage"
        })
      })
    );
    const body = await response.json();
    const repo = await createWaitlistRepository();
    const signups = await repo.listActive();
    await repo.close();

    expect(response.status).toBe(201);
    expect(body.signup).toMatchObject({ source: "homepage", status: "active" });
    expect(JSON.stringify(body)).not.toContain("founder@example.com");
    expect(signups).toHaveLength(1);
    expect(signups[0]).toMatchObject({ email: "founder@example.com", role: "AI founder", company: "Example AI" });
  });

  it("rejects invalid email addresses", async () => {
    await setupDatabase();
    const response = await POST(jsonRequest({ email: "not-email" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "valid email is required" });
  });
});

async function setupDatabase() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-waitlist-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
