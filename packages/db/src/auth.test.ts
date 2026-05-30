import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createAuthRepository } from "./auth";

describe("AuthRepository", () => {
  it("creates a workspace-backed session from a single-use magic link", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-auth-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createAuthRepository();
    const link = await repo.createMagicLink("User@Example.com", 60);
    const result = await repo.consumeMagicLink(link.token);
    const secondResult = await repo.consumeMagicLink(link.token);
    const session = result ? await repo.getSession(result.sessionToken) : undefined;
    if (result) await repo.destroySession(result.sessionToken);
    const destroyed = result ? await repo.getSession(result.sessionToken) : undefined;
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(link.email).toBe("user@example.com");
    expect(result?.session.user.email).toBe("user@example.com");
    expect(result?.session.workspace.id).toBeTruthy();
    expect(secondResult).toBeUndefined();
    expect(session?.workspace.id).toBe(result?.session.workspace.id);
    expect(destroyed).toBeUndefined();
  });
});
