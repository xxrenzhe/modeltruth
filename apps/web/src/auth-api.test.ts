import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRepository, ensureSqliteReady } from "@modeltruth/db";
import { POST as LOGOUT } from "./app/api/auth/logout/route";
import { POST as MAGIC_LINK } from "./app/api/auth/magic-link/route";
import { GET as SESSION } from "./app/api/auth/session/route";
import { GET as VERIFY } from "./app/api/auth/verify/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let previousNodeEnv: string | undefined;
let previousDevExpose: string | undefined;
let previousWebhookUrl: string | undefined;
let previousWebhookToken: string | undefined;
let tempDir: string | undefined;

describe("auth API routes", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    restoreEnv();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("fails closed in production when magic link delivery is not configured", async () => {
    await setupDatabase();
    setNodeEnv("production");
    delete process.env.AUTH_DEV_EXPOSE_MAGIC_LINK;
    delete process.env.AUTH_MAGIC_LINK_WEBHOOK_URL;

    const response = await MAGIC_LINK(jsonRequest("http://localhost/api/auth/magic-link", { email: "prod@example.com" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("magic link delivery is not configured");
  });

  it("creates a dev-visible magic link, verifies it once, exposes session, and logs out", async () => {
    await setupDatabase();
    setNodeEnv("production");
    process.env.AUTH_DEV_EXPOSE_MAGIC_LINK = "true";

    const linkResponse = await MAGIC_LINK(jsonRequest("http://localhost/api/auth/magic-link", { email: "auth-route@example.com" }));
    const linkBody = await linkResponse.json();
    const verifyResponse = await VERIFY(new Request(linkBody.verificationUrl));
    const setCookie = verifyResponse.headers.get("set-cookie") ?? "";
    cookieState.sessionToken = parseCookieValue(setCookie, "mt_session");
    const sessionResponse = await SESSION();
    const sessionBody = await sessionResponse.json();
    const secondVerify = await VERIFY(new Request(linkBody.verificationUrl));
    const logoutResponse = await LOGOUT();
    const afterLogout = await SESSION();

    expect(linkResponse.status).toBe(200);
    expect(linkBody).toMatchObject({ ok: true, email: "auth-route@example.com" });
    expect(linkBody.verificationUrl).toContain("/api/auth/verify?token=");
    expect(verifyResponse.status).toBe(307);
    expect(setCookie).toContain("mt_session=");
    expect(cookieState.sessionToken).toBeTruthy();
    expect(sessionResponse.status).toBe(200);
    expect(sessionBody).toMatchObject({
      authenticated: true,
      session: { user: { email: "auth-route@example.com" } }
    });
    expect(secondVerify.status).toBe(401);
    expect(await secondVerify.json()).toMatchObject({ error: "invalid or expired token" });
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toContain("mt_session=");
    expect(afterLogout.status).toBe(401);
    expect(await afterLogout.json()).toEqual({ authenticated: false });
  });

  it("delivers magic links through the configured webhook without exposing the URL in production", async () => {
    await setupDatabase();
    setNodeEnv("production");
    process.env.AUTH_MAGIC_LINK_WEBHOOK_URL = "https://mailer.example.com/modeltruth";
    process.env.AUTH_MAGIC_LINK_WEBHOOK_TOKEN = "auth_webhook_token";
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await MAGIC_LINK(jsonRequest("http://localhost/api/auth/magic-link", { email: "webhook@example.com" }));
    const body = await response.json();
    const webhookBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, email: "webhook@example.com" });
    expect(body.verificationUrl).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("https://mailer.example.com/modeltruth", expect.any(Object));
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer auth_webhook_token" });
    expect(webhookBody.email).toBe("webhook@example.com");
    expect(webhookBody.verificationUrl).toContain("/api/auth/verify?token=");
  });

  it("rejects missing verify tokens and reports unauthenticated sessions", async () => {
    await setupDatabase();

    const verifyResponse = await VERIFY(new Request("http://localhost/api/auth/verify"));
    const sessionResponse = await SESSION();

    expect(verifyResponse.status).toBe(400);
    expect(await verifyResponse.json()).toEqual({ error: "token is required" });
    expect(sessionResponse.status).toBe(401);
    expect(await sessionResponse.json()).toEqual({ authenticated: false });
  });
});

async function setupDatabase() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-auth-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  previousNodeEnv = process.env.NODE_ENV;
  previousDevExpose = process.env.AUTH_DEV_EXPOSE_MAGIC_LINK;
  previousWebhookUrl = process.env.AUTH_MAGIC_LINK_WEBHOOK_URL;
  previousWebhookToken = process.env.AUTH_MAGIC_LINK_WEBHOOK_TOKEN;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
}

function restoreEnv() {
  restore("DATABASE_PATH", previousDatabasePath);
  setNodeEnv(previousNodeEnv);
  restore("AUTH_DEV_EXPOSE_MAGIC_LINK", previousDevExpose);
  restore("AUTH_MAGIC_LINK_WEBHOOK_URL", previousWebhookUrl);
  restore("AUTH_MAGIC_LINK_WEBHOOK_TOKEN", previousWebhookToken);
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function setNodeEnv(value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env["NODE_ENV"];
  else env["NODE_ENV"] = value;
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function parseCookieValue(setCookie: string, name: string) {
  return (
    setCookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
