import { describe, expect, it } from "vitest";
import { runSmokeAudit } from "./index";

describe("runSmokeAudit", () => {
  it("calls OpenAI-compatible chat completions and stores only redacted evidence", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "smoke@1.0.0",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            model: "gpt-5.1",
            choices: [{ message: { content: "modeltruth-smoke-ok" } }],
            usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect(calls[0].init?.headers).toMatchObject({ authorization: "Bearer sk-test-secret" });
    expect(result.overallStatus).toBe("pass");
    expect(result.evidenceSummary.requestBodyStored).toBe(false);
    expect(result.evidenceSummary.responseBodyStored).toBe(false);
    expect(JSON.stringify(result)).not.toContain("modeltruth-smoke-ok");
    expect(result.evidenceSummary.completionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects local and private endpoints before making requests", async () => {
    let called = false;
    await expect(() =>
      runSmokeAudit({
        baseUrl: "https://127.0.0.1/v1",
        apiKey: "sk-test-secret",
        model: "gpt-5.1",
        suiteId: "smoke@1.0.0",
        fetchImpl: async () => {
          called = true;
          return new Response("{}");
        }
      })
    ).rejects.toThrow("Local or private endpoints are not allowed");
    expect(called).toBe(false);
  });
});
