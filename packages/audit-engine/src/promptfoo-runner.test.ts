import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelTruthPromptfooProvider, runPromptfooMatrix } from "./promptfoo-runner";

afterEach(() => {
  vi.useRealTimers();
});

describe("ModelTruthPromptfooProvider", () => {
  it("implements the promptfoo ApiProvider callApi contract with redacted metadata", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new ModelTruthPromptfooProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      maxTokens: 32,
      dnsLookup: async () => [{ address: "203.0.113.10" }],
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            model: "gpt-5.1",
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
          }),
          {
            status: 200,
            statusText: "OK",
            headers: {
              "content-type": "application/json",
              authorization: "never",
              "rate-limit-remaining": "12",
              "x-ratelimit-reset": "60",
              "x-provider-usage": "tokens=6"
            }
          }
        );
      }
    });

    const [result] = await runPromptfooMatrix({
      provider,
      prompts: [{ id: "smoke", raw: "Reply ok" }]
    });

    expect(provider.id()).toBe("modeltruth:openai-compatible");
    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect(calls[0].init?.headers).toMatchObject({ authorization: "Bearer sk-test-secret" });
    expect(calls[0].init?.redirect).toBe("manual");
    expect(result.promptId).toBe("smoke");
    expect(result.response.output).toBe("ok");
    expect(result.response.tokenUsage).toMatchObject({ prompt: 4, completion: 2, total: 6 });
    expect(result.response.metadata?.http?.headers).toEqual({
      "content-type": "application/json",
      "rate-limit-remaining": "12",
      "x-provider-usage": "tokens=6",
      "x-ratelimit-reset": "60"
    });
    expect(JSON.stringify(result.response.metadata)).not.toContain("sk-test-secret");
  });

  it("rejects cross-host redirects instead of following them", async () => {
    const provider = new ModelTruthPromptfooProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      maxTokens: 32,
      dnsLookup: async () => [{ address: "203.0.113.10" }],
      fetchImpl: async () => new Response("", { status: 302, headers: { location: "https://metadata.google.internal/latest" } })
    });

    await expect(provider.callApi("hello")).rejects.toThrow("Cross-host redirects are not allowed");
  });

  it("rejects hostnames that resolve to private addresses before fetching", async () => {
    let called = false;
    const provider = new ModelTruthPromptfooProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      maxTokens: 32,
      dnsLookup: async () => [{ address: "10.0.0.2" }],
      fetchImpl: async () => {
        called = true;
        return new Response("{}");
      }
    });

    await expect(provider.callApi("hello")).rejects.toThrow("Resolved Base URL address is not public");
    expect(called).toBe(false);
  });

  it("rejects response bodies larger than the 2MB audit limit", async () => {
    const provider = new ModelTruthPromptfooProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      maxTokens: 32,
      dnsLookup: async () => [{ address: "203.0.113.10" }],
      fetchImpl: async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200 })
    });

    await expect(provider.callApi("hello")).rejects.toThrow("Response body exceeded 2097152 bytes");
  });

  it("applies the default 30 second request timeout even when a caller supplies an abort signal", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
        })
    );
    const provider = new ModelTruthPromptfooProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      maxTokens: 32,
      dnsLookup: async () => [{ address: "203.0.113.10" }],
      fetchImpl: fetchImpl as typeof fetch
    });
    const externalController = new AbortController();

    const call = provider.callApi("hello", undefined, { abortSignal: externalController.signal }).catch((error: unknown) => error);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(externalController.signal.aborted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toMatchObject({ message: "AbortError" });
  });

  it("caps custom request timeouts at the 60 second single-run limit", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
        })
    );
    const provider = new ModelTruthPromptfooProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-secret",
      model: "gpt-5.1",
      maxTokens: 32,
      dnsLookup: async () => [{ address: "203.0.113.10" }],
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 90_000
    });

    const call = provider.callApi("hello").catch((error: unknown) => error);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toMatchObject({ message: "AbortError" });
  });
});

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
