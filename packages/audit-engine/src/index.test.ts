import { describe, expect, it } from "vitest";
import { getAuditSuite, listAuditSuites, runSmokeAudit } from "./index";

describe("audit suite registry", () => {
  it("registers supported versioned suites and rejects unknown suites", () => {
    expect(listAuditSuites().map((suite) => `${suite.suiteId}@${suite.suiteVersion}`)).toEqual([
      "smoke@1.0.0",
      "reasoning-lite@1.0.0",
      "context-lite@1.0.0",
      "billing-lite@1.0.0",
      "fingerprint-calibration@1.0.0"
    ]);
    expect(getAuditSuite("context-lite@1.0.0").maxTokens).toBeGreaterThan(32);
    expect(() => getAuditSuite("unregistered@1.0.0")).toThrow("Unsupported audit suite");
    expect(() => getAuditSuite("smoke@9.9.9")).toThrow("Unsupported suite version");
  });
});

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
            choices: [{ message: { content: "modeltruth-smoke-ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-request-id": "req_123",
              authorization: "Bearer response-secret"
            }
          }
        );
      }
    });

    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect(calls[0].init?.headers).toMatchObject({ authorization: "Bearer sk-test-secret" });
    expect(result.overallStatus).toBe("pass");
    expect(result.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(result.evidenceSummary.requestBodyStored).toBe(false);
    expect(result.evidenceSummary.responseBodyStored).toBe(false);
    expect(JSON.stringify(result)).not.toContain("modeltruth-smoke-ok");
    expect(result.evidenceSummary.completionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metrics.usage).toEqual({ promptTokens: 10, completionTokens: 3, totalTokens: 13 });
    expect(result.evidenceSummary.usage).toEqual({ promptTokens: 10, completionTokens: 3, totalTokens: 13 });
    expect(result.metrics.costEstimate).toMatchObject({ provider: "openai", totalCostUsd: 0.000043 });
    expect(result.evidenceSummary.costEstimate).toMatchObject({ currency: "USD", inputTokens: 10, outputTokens: 3 });
    expect(result.evidenceSummary.suiteId).toBe("smoke");
    expect(result.evidenceSummary.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    expect(result.evidenceSummary.openInference).toMatchObject({
      "openinference.span.kind": "LLM",
      "llm.model_name": "gpt-5.1",
      "modeltruth.suite_id": "smoke"
    });
    expect(result.evidenceSummary.requestMetadata).toMatchObject({
      method: "POST",
      model: "gpt-5.1",
      headers: ["authorization:redacted", "content-type"]
    });
    expect(result.evidenceSummary.responseMetadata).toMatchObject({
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req_123" },
      usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
      finishReason: "stop"
    });
    expect(JSON.stringify(result)).not.toContain("prompt_tokens");
    expect(JSON.stringify(result)).not.toContain("completion_tokens");
    expect(JSON.stringify(result)).not.toContain("total_tokens");
    expect(JSON.stringify(result.evidenceSummary.responseMetadata)).not.toContain("response-secret");
    expect(result.evidenceSummary.latencyTimeline?.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.evidenceSummary.promptDiffSummary?.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidenceSummary.promptDiffSummary?.promptHashOnly).toBe(true);
    expect(result.evidenceSummary.responseExcerpt).toBeUndefined();
    expect(result.evidenceSummary.responseExcerptPolicy).toBe("omitted_full_completion");
  });

  it("stores only a secret-scanned response excerpt for long completions", async () => {
    const longCompletion = `${"safe ".repeat(130)}tail`;
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "smoke@1.0.0",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: longCompletion }, finish_reason: "length" }],
            usage: { prompt_tokens: 10, completion_tokens: 120, total_tokens: 130 }
          }),
          { status: 200 }
        )
    });

    expect(result.evidenceSummary.responseExcerpt).toBe(longCompletion.slice(0, 500));
    expect(result.evidenceSummary.responseExcerpt?.length).toBeLessThanOrEqual(500);
    expect(result.evidenceSummary.responseExcerptPolicy).toBe("redacted_excerpt");
    expect(result.evidenceSummary.finishReason).toBe("length");
  });

  it("omits response excerpts when secret scanning detects credentials", async () => {
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "smoke@1.0.0",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: `${"safe ".repeat(120)}sk-response-secret-123456` } }]
          }),
          { status: 200 }
        )
    });

    expect(result.evidenceSummary.responseExcerpt).toBeUndefined();
    expect(JSON.stringify(result.evidenceSummary)).not.toContain("sk-response-secret");
  });

  it("records provider error code and type without storing full error body", async () => {
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "smoke@1.0.0",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "rate_limit_exceeded",
              type: "rate_limit_error",
              message: "full provider error should not persist sk-error-secret-123456"
            }
          }),
          { status: 429, headers: { "content-type": "application/json" } }
        )
    });

    expect(result.overallStatus).toBe("warning");
    expect(result.retestRecommendation).toBe("manual_retest_recommended");
    expect(result.evidenceSummary.errorCode).toBe("rate_limit_exceeded");
    expect(result.evidenceSummary.errorType).toBe("rate_limit_error");
    expect(result.evidenceSummary.responseMetadata).toMatchObject({
      status: 429,
      errorCode: "rate_limit_exceeded",
      errorType: "rate_limit_error"
    });
    expect(JSON.stringify(result.evidenceSummary)).not.toContain("full provider error");
    expect(JSON.stringify(result.evidenceSummary)).not.toContain("sk-error-secret");
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

  it("runs reasoning-lite with nonce and answer assertions", async () => {
    let capturedNonce = "";
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "reasoning-lite@1.0.0",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        const prompt = body.messages.at(-1)?.content ?? "";
        const nonce = prompt.match(/session_nonce=([0-9a-f-]+)/)?.[1];
        const numericNonce = Number(prompt.match(/17 \* 23 \+ (\d+)/)?.[1]);
        expect(nonce).toBeTruthy();
        capturedNonce = nonce ?? "";
        return new Response(
          JSON.stringify({
            model: "gpt-5.1",
            choices: [{ message: { content: JSON.stringify({ answer: String(17 * 23 + numericNonce), session_nonce: nonce }) } }],
            usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    expect(result.overallStatus).toBe("pass");
    expect(result.assertions.find((assertion) => assertion.id === "REASONING_FINAL_ANSWER")?.status).toBe("pass");
    expect(result.assertions.find((assertion) => assertion.id === "REASONING_FINAL_ANSWER")?.weight).toBe(0.25);
    expect(result.evidenceSummary.numericNonceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidenceSummary.timestampBucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);
    expect(JSON.stringify(result)).not.toContain(capturedNonce);
  });

  it("runs context-lite and evaluates synthetic needle retrieval", async () => {
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "context-lite@1.0.0",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        const prompt = body.messages.at(-1)?.content ?? "";
        const needles = [...prompt.matchAll(/needle_[a-z]+=[0-9a-f-]+/g)].map((match) => match[0]);
        expect(prompt).toContain("session_nonce=");
        expect(prompt).toContain("numeric_nonce=");
        expect(prompt).toContain("timestamp_bucket=");
        expect(prompt.split(/\s+/).length).toBeGreaterThan(8_000);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: needles.join(" ") } }],
            usage: { completion_tokens: 20 }
          }),
          { status: 200 }
        );
      }
    });

    expect(result.overallStatus).toBe("pass");
    expect(result.assertions.find((assertion) => assertion.id === "CONTEXT_NEEDLE_RETRIEVAL")?.message).toContain("3/3");
    expect(result.evidenceSummary.promptDiffSummary).toMatchObject({
      contextTokenEstimate: expect.any(Number),
      needleDepths: expect.arrayContaining([expect.any(Number)]),
      numericNoncePresent: true,
      timestampBucketPresent: true
    });
  });

  it("runs billing-lite but marks billing variance inconclusive without a balance source", async () => {
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "billing-lite@1.0.0",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        const prompt = body.messages.at(-1)?.content ?? "";
        const nonce = prompt.match(/session_nonce=([0-9a-f-]+)/)?.[1];
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: `ok ${nonce}` } }],
            usage: { prompt_tokens: 18, completion_tokens: 5, total_tokens: 23 }
          }),
          { status: 200 }
        );
      }
    });

    expect(result.overallStatus).toBe("warning");
    expect(result.assertions.find((assertion) => assertion.id === "BILLING_BALANCE_SOURCE")?.status).toBe("inconclusive");
  });

  it("fails billing-lite and requests retest when variance exceeds 15 percent", async () => {
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "billing-lite@1.0.0",
      billingSnapshot: {
        expectedCostUsd: 1,
        balanceBeforeUsd: 10,
        balanceAfterUsd: 8.8
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 18, completion_tokens: 5, total_tokens: 23 }
          }),
          { status: 200 }
        )
    });

    expect(result.overallStatus).toBe("warning");
    expect(result.retestRecommendation).toBe("automatic_retest_required");
    expect(result.assertions.find((assertion) => assertion.id === "BILLING_VARIANCE")?.status).toBe("fail");
    expect(result.metrics.billingVariance).toMatchObject({ status: "fail", retestRequired: true, direction: "overcharged" });
    expect(result.evidenceSummary.billingVariance).toMatchObject({ varianceRatio: 0.2, retestRequired: true });
    expect(result.evidenceSummary.retestRecommendation).toBe("automatic_retest_required");
  });

  it("warns billing-lite when variance is between 5 and 15 percent", async () => {
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "billing-lite@1.0.0",
      billingSnapshot: {
        expectedCostUsd: 1,
        balanceBeforeUsd: 10,
        balanceAfterUsd: 8.9
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { total_tokens: 23 }
          }),
          { status: 200 }
        )
    });

    expect(result.overallStatus).toBe("warning");
    expect(result.metrics.billingVariance).toMatchObject({ status: "warning", retestRequired: false });
  });

  it("marks credential rejection as a P0 error", async () => {
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "smoke@1.0.0",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: "invalid_api_key", type: "authentication_error" } }), { status: 401 })
    });

    expect(result.overallStatus).toBe("error");
    expect(result.assertions.find((assertion) => assertion.id === "HTTP_STATUS_OK")?.status).toBe("error");
    expect(result.retestRecommendation).toBe("manual_retest_recommended");
  });

  it("runs the internal fingerprint calibration suite as a registered versioned suite", async () => {
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "fingerprint-calibration@1.0.0",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        const prompt = body.messages.at(-1)?.content ?? "";
        const nonce = prompt.match(/session_nonce=([0-9a-f-]+)/)?.[1];
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ model_family: "gpt-5", capabilities: ["reasoning"], nonce }) } }],
            usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 }
          }),
          { status: 200 }
        );
      }
    });

    expect(result.evidenceSummary.suiteId).toBe("fingerprint-calibration");
    expect(result.evidenceSummary.suiteVersion).toBe("1.0.0");
    expect(result.overallStatus).toBe("pass");
  });

  it("adds registry-driven model status and capability assertions", async () => {
    const result = await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "reasoning-lite@1.0.0",
      modelProfile: {
        provider: "openai",
        modelId: "gpt-5.1",
        family: "gpt-5",
        status: "experimental",
        supportsReasoningUsage: false,
        supportsStreaming: true,
        baselineSuiteVersion: "fingerprint-calibration@1.0.0"
      },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        const prompt = body.messages.at(-1)?.content ?? "";
        const nonce = prompt.match(/session_nonce=([0-9a-f-]+)/)?.[1];
        const numericNonce = Number(prompt.match(/17 \* 23 \+ (\d+)/)?.[1]);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ answer: String(17 * 23 + numericNonce), session_nonce: nonce }) } }]
          }),
          { status: 200 }
        );
      }
    });

    expect(result.assertions.find((assertion) => assertion.id === "MODEL_REGISTRY_STATUS")?.status).toBe("inconclusive");
    expect(result.assertions.find((assertion) => assertion.id === "REASONING_USAGE_UNSUPPORTED")?.status).toBe("inconclusive");
    expect(result.evidenceSummary.modelRegistry).toMatchObject({ provider: "openai", modelId: "gpt-5.1" });
  });

  it("reproduces materially equivalent results for the same suite, input and target model", async () => {
    const input = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "smoke@1.0.0",
      nonceFactory: () => "11111111-2222-4333-8444-555555555555",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: "gpt-5.1",
            choices: [{ message: { content: "modeltruth-smoke-11111111-2222-4333-8444-555555555555" } }],
            usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    };

    const first = await runSmokeAudit(input);
    const second = await runSmokeAudit(input);

    expect(second.overallStatus).toBe(first.overallStatus);
    expect(second.assertions).toEqual(first.assertions);
    expect(second.evidenceSummary.promptNonceHash).toBe(first.evidenceSummary.promptNonceHash);
    expect(second.evidenceSummary.completionHash).toBe(first.evidenceSummary.completionHash);
  });

  it("applies a target-host request limiter before sending audit traffic", async () => {
    const events: string[] = [];
    await runSmokeAudit({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      suiteId: "smoke@1.0.0",
      requestLimiter: async (targetHost) => {
        events.push(`limit:${targetHost}`);
      },
      fetchImpl: async () => {
        events.push("fetch");
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "modeltruth-smoke-ok" } }]
          }),
          { status: 200 }
        );
      }
    });

    expect(events).toEqual(["limit:api.example.com", "fetch"]);
  });
});
