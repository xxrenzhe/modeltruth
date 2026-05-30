import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "@modeltruth/crypto";
import { createAlertChannelRepository, ensureSqliteReady } from "@modeltruth/db";
import { createAuthRepository } from "@modeltruth/db";
import { deliverAlert } from "./index";

describe("deliverAlert", () => {
  it("posts redacted alert payloads to enabled webhook channels", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-notifier-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("notifier@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();

    const channels = await createAlertChannelRepository();
    await channels.create({
      workspaceId: session!.session.workspace.id,
      type: "webhook",
      encryptedTarget: encryptSecret("https://hooks.example.com/modeltruth")
    });
    await channels.close();

    const calls: Array<{ url: string; body?: string }> = [];
    const delivered = await deliverAlert(
      {
        workspaceId: session!.session.workspace.id,
        runId: "run_alert",
        status: "fail",
        message: "ModelTruth audit fail"
      },
      async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return new Response("ok", { status: 200 });
      }
    );

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(delivered).toBe(1);
    expect(calls[0].url).toBe("https://hooks.example.com/modeltruth");
    expect(calls[0].body).toContain("run_alert");
    expect(calls[0].body).not.toContain("hooks.example.com/modeltruth");
  });
});
