import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./index";

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
    expect(report).toContain("modeltruth.report.v1");
    expect(report).not.toContain("sk-cli-secret");
    expect(report).not.toContain("modeltruth-smoke-ok");
  });

  it("requires explicit consent before upload", async () => {
    const result = await runCli(["upload", "--run", "report.json"], { NODE_ENV: "test" } as NodeJS.ProcessEnv);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("upload requires --consent true");
  });
});
