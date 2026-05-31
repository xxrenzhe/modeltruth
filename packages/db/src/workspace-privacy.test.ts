import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createAuthRepository } from "./auth";
import { createWorkspacePrivacyRepository } from "./workspace-privacy";

describe("WorkspacePrivacyRepository", () => {
  it("defaults to not saving full responses and persists explicit opt-in", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-workspace-privacy-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("privacy@example.com");
    const login = await auth.consumeMagicLink(link.token);
    await auth.close();

    const repo = await createWorkspacePrivacyRepository();
    const defaults = await repo.get(login!.session.workspace.id);
    const updated = await repo.update(login!.session.workspace.id, { saveFullResponses: true });
    const reloaded = await repo.get(login!.session.workspace.id);
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(defaults.saveFullResponses).toBe(false);
    expect(updated.saveFullResponses).toBe(true);
    expect(reloaded.saveFullResponses).toBe(true);
  });
});
