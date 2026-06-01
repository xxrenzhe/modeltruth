import { afterEach, describe, expect, it, vi } from "vitest";
import { LiteLLMAdapter } from "./litellm-adapter";

afterEach(() => {
  vi.useRealTimers();
});

describe("LiteLLMAdapter", () => {
  it("calls a LiteLLM OpenAI-compatible proxy without storing prompt output", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = new LiteLLMAdapter({
      proxyBaseUrl: "https://llm-gateway.example.com/v1",
      apiKey: "sk-litellm",
      model: "openai/gpt-5.1",
      maxTokens: 32,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            model: "openai/gpt-5.1",
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }
          }),
          { status: 200 }
        );
      }
    });

    const result = await adapter.callApi("ping");

    expect(adapter.id()).toBe("modeltruth:litellm");
    expect(adapter.adapterKind).toBe("litellm");
    expect(calls[0].url).toBe("https://llm-gateway.example.com/v1/chat/completions");
    expect(calls[0].init?.headers).toMatchObject({
      authorization: "Bearer sk-litellm",
      "x-modeltruth-adapter": "litellm"
    });
    expect(calls[0].init?.redirect).toBe("manual");
    expect(result.output).toBe("ok");
    expect(result.metadata).toMatchObject({ adapter: "litellm", model: "openai/gpt-5.1" });
    expect(result.tokenUsage).toMatchObject({ prompt: 4, completion: 1, total: 5 });
  });

  it("rejects local LiteLLM proxies unless explicitly enabled for same-container sidecars", async () => {
    const rejected = new LiteLLMAdapter({
      proxyBaseUrl: "http://127.0.0.1:4000/v1",
      apiKey: "sk-litellm",
      model: "openai/gpt-5.1",
      fetchImpl: async () => new Response("{}")
    });
    await expect(() => rejected.callApi("ping")).rejects.toThrow("LiteLLM proxy URL must use HTTPS");

    const allowed = new LiteLLMAdapter({
      proxyBaseUrl: "http://127.0.0.1:4000/v1",
      apiKey: "sk-litellm",
      model: "openai/gpt-5.1",
      allowLocalProxy: true,
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }))
    });
    await expect(allowed.callApi("ping")).resolves.toMatchObject({ output: "ok" });
  });

  it("rejects LiteLLM proxy hostnames that resolve to private addresses", async () => {
    let called = false;
    const adapter = new LiteLLMAdapter({
      proxyBaseUrl: "https://llm-gateway.example.com/v1",
      apiKey: "sk-litellm",
      model: "openai/gpt-5.1",
      dnsLookup: async () => [{ address: "10.0.0.2" }],
      fetchImpl: async () => {
        called = true;
        return new Response("{}");
      }
    });

    await expect(adapter.callApi("ping")).rejects.toThrow("Resolved LiteLLM proxy address is not public");
    expect(called).toBe(false);
  });

  it("rejects cross-host redirects and oversized LiteLLM responses", async () => {
    const redirect = new LiteLLMAdapter({
      proxyBaseUrl: "https://llm-gateway.example.com/v1",
      apiKey: "sk-litellm",
      model: "openai/gpt-5.1",
      fetchImpl: async () => new Response("", { status: 302, headers: { location: "https://metadata.google.internal/latest" } })
    });
    await expect(redirect.callApi("ping")).rejects.toThrow("Cross-host redirects are not allowed for LiteLLM proxy");

    const oversized = new LiteLLMAdapter({
      proxyBaseUrl: "https://llm-gateway.example.com/v1",
      apiKey: "sk-litellm",
      model: "openai/gpt-5.1",
      fetchImpl: async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200 })
    });
    await expect(oversized.callApi("ping")).rejects.toThrow("LiteLLM response exceeded 2097152 bytes");
  });

  it("keeps the 30 second internal timeout when a caller supplies an abort signal", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
        })
    );
    const adapter = new LiteLLMAdapter({
      proxyBaseUrl: "https://llm-gateway.example.com/v1",
      apiKey: "sk-litellm",
      model: "openai/gpt-5.1",
      fetchImpl: fetchImpl as typeof fetch
    });
    const externalController = new AbortController();

    const call = adapter.callApi("ping", undefined, { abortSignal: externalController.signal }).catch((error: unknown) => error);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(externalController.signal.aborted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(call).resolves.toMatchObject({ message: "AbortError" });
  });

  it("caps LiteLLM custom timeouts at the 60 second single-run limit", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener("abort", () => reject(new Error("AbortError")), { once: true });
        })
    );
    const adapter = new LiteLLMAdapter({
      proxyBaseUrl: "https://llm-gateway.example.com/v1",
      apiKey: "sk-litellm",
      model: "openai/gpt-5.1",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 90_000
    });

    const call = adapter.callApi("ping").catch((error: unknown) => error);
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
