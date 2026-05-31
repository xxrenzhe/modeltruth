import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createAuthRepository } from "./auth";
import { createByoProbeRepository } from "./probes";

describe("ByoProbeRepository", () => {
  it("registers probes with one-time tokens and accepts token heartbeats", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-byo-probes-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("probe-owner@example.com");
    const login = await auth.consumeMagicLink(link.token);
    await auth.close();

    const repo = await createByoProbeRepository();
    const registered = await repo.register({ workspaceId: login!.session.workspace.id, name: "Tokyo Probe", region: "ap-northeast-1" });
    const missing = await repo.heartbeat({ token: "mtp_invalid", version: "0.1.0" });
    const active = await repo.heartbeat({ token: registered.token, version: "0.1.0" });
    const listed = await repo.list(login!.session.workspace.id);
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(registered.token).toMatch(/^mtp_/);
    expect(JSON.stringify(listed)).not.toContain(registered.token);
    expect(missing).toBeUndefined();
    expect(active).toMatchObject({ status: "active", version: "0.1.0", region: "ap-northeast-1" });
    expect(listed[0]).toMatchObject({ name: "Tokyo Probe", status: "active" });
  });
});
