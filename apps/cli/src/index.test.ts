import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, runCliWithOptions } from "./index";

describe("modeltruth cli", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("runs a local audit and writes a redacted report", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-cli-"));
    const reportPath = path.join(dir, "report.json");
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: "gpt-5.1",
          choices: [{ message: { content: "modeltruth-smoke-ok" } }],
          usage: { total_tokens: 12 }
        }),
        { status: 200 }
      )
    ) as typeof fetch;

    const result = await runCli(
      [
        "audit",
        "--base-url",
        "https://api.example.com/v1",
        "--model",
        "gpt-5.1",
        "--api-key",
        "sk-cli-secret-123456",
        "--output",
        reportPath
      ],
      { NODE_ENV: "test" } as NodeJS.ProcessEnv
    );
    const report = readFileSync(reportPath, "utf8");
    rmSync(dir, { recursive: true, force: true });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).uploaded).toBe(false);
    expect(report).toContain("modeltruth.report.v1");
    expect(report).not.toContain("sk-cli-secret");
    expect(report).not.toContain("modeltruth-smoke-ok");
  });

  it("uploads only when audit is run with explicit consent-upload", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-cli-consent-"));
    const reportPath = path.join(dir, "report.json");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "gpt-5.1",
            choices: [{ message: { content: "modeltruth-smoke-ok" } }],
            usage: { total_tokens: 12, rawPrompt: "full prompt should stay local" }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ uploaded: true }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runCli(
      [
        "audit",
        "--base-url",
        "https://api.example.com/v1",
        "--model",
        "gpt-5.1",
        "--api-key",
        "sk-cli-secret-123456",
        "--output",
        reportPath,
        "--api-base",
        "https://modeltruth.ai",
        "--consent-upload",
        "true"
      ],
      { NODE_ENV: "test" } as NodeJS.ProcessEnv
    );
    const uploadBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    rmSync(dir, { recursive: true, force: true });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).uploaded).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://modeltruth.ai/api/cli/upload");
    expect(uploadBody.consent).toBe(true);
    expect(JSON.stringify(uploadBody)).not.toContain("sk-cli-secret");
    expect(JSON.stringify(uploadBody)).not.toContain("https://api.example.com/v1");
    expect(JSON.stringify(uploadBody)).not.toContain("modeltruth-smoke-ok");
    expect(JSON.stringify(uploadBody)).not.toContain("full prompt should stay local");
  });

  it("reads the API key from interactive input when flags and env are absent", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-cli-interactive-"));
    const reportPath = path.join(dir, "report.json");
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "modeltruth-smoke-ok" } }],
          usage: { total_tokens: 12 }
        }),
        { status: 200 }
      )
    ) as typeof fetch;

    const result = await runCliWithOptions(
      [
        "audit",
        "--base-url",
        "https://api.example.com/v1",
        "--model",
        "gpt-5.1",
        "--output",
        reportPath
      ],
      { env: { NODE_ENV: "test" } as NodeJS.ProcessEnv, apiKeyReader: async () => "sk-interactive-secret-123456" }
    );
    const report = readFileSync(reportPath, "utf8");
    rmSync(dir, { recursive: true, force: true });

    expect(result.exitCode).toBe(0);
    expect(report).not.toContain("sk-interactive-secret");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer sk-interactive-secret-123456" })
      })
    );
  });

  it("requires explicit consent before upload", async () => {
    const result = await runCli(["upload", "--run", "report.json"], { NODE_ENV: "test" } as NodeJS.ProcessEnv);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("upload requires --consent true");
  });

  it("tracks local repeat audits for activation without storing secrets or raw endpoint URLs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-cli-activation-"));
    const previousCliHome = process.env.MODELTRUTH_CLI_HOME;
    process.env.MODELTRUTH_CLI_HOME = dir;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "modeltruth-smoke-ok" } }],
          usage: { total_tokens: 12 }
        }),
        { status: 200 }
      )
    ) as typeof fetch;

    const args = [
      "audit",
      "--base-url",
      "https://api.example.com/v1",
      "--model",
      "gpt-5.1",
      "--api-key",
      "sk-cli-secret-activation",
      "--output",
      path.join(dir, "report.json")
    ];
    const first = await runCli(args, { NODE_ENV: "test" } as NodeJS.ProcessEnv);
    const second = await runCli(args, { NODE_ENV: "test" } as NodeJS.ProcessEnv);
    const third = await runCli(args, { NODE_ENV: "test" } as NodeJS.ProcessEnv);
    const history = readFileSync(path.join(dir, "audit-history.json"), "utf8");

    if (previousCliHome === undefined) delete process.env.MODELTRUTH_CLI_HOME;
    else process.env.MODELTRUTH_CLI_HOME = previousCliHome;
    rmSync(dir, { recursive: true, force: true });

    expect(JSON.parse(first.stdout).activationCta).toBeUndefined();
    expect(JSON.parse(second.stdout).activationCta).toBeUndefined();
    expect(JSON.parse(third.stdout).activationCta).toContain("https://modeltruth.ai/pro");
    expect(history).toContain("modeltruth.cli-audit-history.v1");
    expect(history).toContain("\"count\": 3");
    expect(history).not.toContain("sk-cli-secret-activation");
    expect(history).not.toContain("https://api.example.com");
    expect(history).not.toContain("modeltruth-smoke-ok");
  });

  it("persists login session and reuses it for later uploads", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-cli-login-"));
    const reportPath = path.join(dir, "report.json");
    const previousCliHome = process.env.MODELTRUTH_CLI_HOME;
    process.env.MODELTRUTH_CLI_HOME = dir;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: "cli@example.com",
            verificationUrl: "https://modeltruth.ai/api/auth/verify?token=magic-token"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { "set-cookie": "mt_session=session-token-123; Path=/; HttpOnly" }
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ uploaded: true, runId: "uploaded_run" }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const report = {
      schemaVersion: "modeltruth.report.v1",
      generatedAt: "2026-05-31T00:00:00.000Z",
      suiteId: "smoke@1.0.0",
      result: {
        runId: "local_run",
        overallStatus: "pass",
        confidence: 0.9,
        metrics: { totalLatencyMs: 100 },
        assertions: [],
        evidenceSummary: { redaction: "applied" }
      }
    };
    writeFileSync(reportPath, JSON.stringify(report));

    const login = await runCli(["login", "--email", "cli@example.com", "--api-base", "https://modeltruth.ai"]);
    const upload = await runCli(["upload", "--run", reportPath, "--consent", "true"]);
    const config = JSON.parse(readFileSync(path.join(dir, "config.json"), "utf8"));

    if (previousCliHome === undefined) delete process.env.MODELTRUTH_CLI_HOME;
    else process.env.MODELTRUTH_CLI_HOME = previousCliHome;
    rmSync(dir, { recursive: true, force: true });

    expect(login.exitCode).toBe(0);
    expect(JSON.parse(login.stdout)).toEqual({ apiBase: "https://modeltruth.ai", authenticated: true });
    expect(config).toMatchObject({ apiBase: "https://modeltruth.ai", sessionToken: "session-token-123" });
    expect(upload.exitCode).toBe(0);
    expect(JSON.parse(upload.stdout)).toMatchObject({ uploaded: true, runId: "uploaded_run" });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://modeltruth.ai/api/cli/upload");
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({ cookie: "mt_session=session-token-123" });
  });

  it("clears local CLI session and audit history when privacy consent is withdrawn", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-cli-privacy-reset-"));
    const previousCliHome = process.env.MODELTRUTH_CLI_HOME;
    process.env.MODELTRUTH_CLI_HOME = dir;
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ apiBase: "https://modeltruth.ai", sessionToken: "session-token-123" }));
    writeFileSync(
      path.join(dir, "audit-history.json"),
      JSON.stringify({ schemaVersion: "modeltruth.cli-audit-history.v1", endpoints: { endpoint_hash: { count: 3 } } })
    );
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await runCli(["privacy-reset"]);
    const body = JSON.parse(result.stdout);

    if (previousCliHome === undefined) delete process.env.MODELTRUTH_CLI_HOME;
    else process.env.MODELTRUTH_CLI_HOME = previousCliHome;
    const configExists = existsSync(path.join(dir, "config.json"));
    const historyExists = existsSync(path.join(dir, "audit-history.json"));
    rmSync(dir, { recursive: true, force: true });

    expect(result.exitCode).toBe(0);
    expect(body).toMatchObject({ reset: true });
    expect(body.removed).toEqual(expect.arrayContaining(["config.json", "audit-history.json"]));
    expect(configExists).toBe(false);
    expect(historyExists).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
