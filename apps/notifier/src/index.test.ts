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

  it("routes email alert channels through the configured email webhook", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-notifier-email-"));
    const previousPath = process.env.DATABASE_PATH;
    const previousWebhook = process.env.EMAIL_ALERT_WEBHOOK_URL;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    process.env.EMAIL_ALERT_WEBHOOK_URL = "https://email.example.com/send";
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("email-notifier@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();

    const channels = await createAlertChannelRepository();
    await channels.create({
      workspaceId: session!.session.workspace.id,
      type: "email",
      encryptedTarget: encryptSecret("alerts@example.com"),
      targetSuffix: "al***@example.com"
    });
    await channels.close();

    const calls: Array<{ url: string; body?: string }> = [];
    const delivered = await deliverAlert(
      {
        workspaceId: session!.session.workspace.id,
        runId: "run_email_alert",
        status: "warning",
        message: "ModelTruth audit warning"
      },
      async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return new Response("ok", { status: 200 });
      }
    );

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    if (previousWebhook === undefined) delete process.env.EMAIL_ALERT_WEBHOOK_URL;
    else process.env.EMAIL_ALERT_WEBHOOK_URL = previousWebhook;
    rmSync(dir, { recursive: true, force: true });

    expect(delivered).toBe(1);
    expect(calls[0].url).toBe("https://email.example.com/send");
    expect(calls[0].body).toContain("alerts@example.com");
    expect(calls[0].body).toContain("run_email_alert");
  });

  it("formats Slack and Discord alert channel payloads", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-notifier-chat-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("chat-notifier@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();

    const channels = await createAlertChannelRepository();
    await channels.create({
      workspaceId: session!.session.workspace.id,
      type: "slack",
      encryptedTarget: encryptSecret("https://hooks.slack.example.com/modeltruth")
    });
    await channels.create({
      workspaceId: session!.session.workspace.id,
      type: "discord",
      encryptedTarget: encryptSecret("https://discord.example.com/api/webhooks/modeltruth")
    });
    await channels.close();

    const calls: Array<{ url: string; body?: string }> = [];
    const delivered = await deliverAlert(
      {
        workspaceId: session!.session.workspace.id,
        runId: "run_chat_alert",
        status: "fail",
        message: "ModelTruth chat alert"
      },
      async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return new Response("ok", { status: 200 });
      }
    );

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(delivered).toBe(2);
    expect(calls.map((call) => call.url).sort()).toEqual([
      "https://discord.example.com/api/webhooks/modeltruth",
      "https://hooks.slack.example.com/modeltruth"
    ]);
    expect(calls.find((call) => call.url.includes("slack"))?.body).toContain("\"text\"");
    expect(calls.find((call) => call.url.includes("discord"))?.body).toContain("\"embeds\"");
    expect(JSON.stringify(calls)).toContain("run_chat_alert");
  });

  it("delivers Telegram alerts through the Telegram Bot API", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-notifier-telegram-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("telegram-notifier@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();

    const channels = await createAlertChannelRepository();
    await channels.create({
      workspaceId: session!.session.workspace.id,
      type: "telegram",
      encryptedTarget: encryptSecret(JSON.stringify({ botToken: "123456789:telegramSecretTokenValue", chatId: "-1001234567890" })),
      targetSuffix: "telegram:-1001234567890"
    });
    await channels.close();

    const calls: Array<{ url: string; body?: string }> = [];
    const delivered = await deliverAlert(
      {
        workspaceId: session!.session.workspace.id,
        runId: "run_telegram_alert",
        status: "fail",
        message: "ModelTruth Telegram warning"
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
    expect(calls[0].url).toBe("https://api.telegram.org/bot123456789:telegramSecretTokenValue/sendMessage");
    expect(calls[0].body).toContain('"chat_id":"-1001234567890"');
    expect(calls[0].body).toContain("run_telegram_alert");
  });
});
