import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "@modeltruth/crypto";
import { ensureSqliteReady } from "./index";
import { createAlertChannelRepository } from "./alert-channels";
import { createAuthRepository } from "./auth";

describe("AlertChannelRepository", () => {
  it("stores encrypted alert targets and returns secrets only for delivery", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-alerts-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("alerts@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();

    const repo = await createAlertChannelRepository();
    const channel = await repo.create({
      workspaceId: session!.session.workspace.id,
      type: "email",
      encryptedTarget: encryptSecret("alerts@example.com"),
      targetSuffix: "al***@example.com"
    });
    const listed = await repo.list(session!.session.workspace.id);
    const secrets = await repo.listEnabledSecrets(session!.session.workspace.id);
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(channel.type).toBe("email");
    expect(listed[0].targetSuffix).toBe("al***@example.com");
    expect(JSON.stringify(listed)).not.toContain("alerts@example.com");
    expect(secrets[0].encryptedTarget).toContain("v1:");
  });

  it("stores Telegram alert targets without exposing bot tokens in list output", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-alerts-telegram-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("telegram-alerts@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();

    const repo = await createAlertChannelRepository();
    const channel = await repo.create({
      workspaceId: session!.session.workspace.id,
      type: "telegram",
      encryptedTarget: encryptSecret(JSON.stringify({ botToken: "123456789:telegramSecretTokenValue", chatId: "-1001234567890" })),
      targetSuffix: "telegram:-1001234567890"
    });
    const listed = await repo.list(session!.session.workspace.id);
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(channel.type).toBe("telegram");
    expect(listed[0].targetSuffix).toBe("telegram:-1001234567890");
    expect(JSON.stringify(listed)).not.toContain("telegramSecretTokenValue");
  });
});
