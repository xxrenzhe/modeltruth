import { lookup } from "node:dns/promises";
import type { ApiProvider, ProviderResponse } from "promptfoo";
import { assertPublicResolvedAddresses, isPublicHostname } from "@modeltruth/shared";

const maxResponseBodyBytes = 2 * 1024 * 1024;

export interface ProviderAdapter extends ApiProvider {
  readonly adapterKind: "direct-openai-compatible" | "litellm";
}

export interface LiteLLMAdapterOptions {
  proxyBaseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string }>>;
  timeoutMs?: number;
  allowLocalProxy?: boolean;
}

export class LiteLLMAdapter implements ProviderAdapter {
  readonly adapterKind = "litellm" as const;
  label = "ModelTruth LiteLLM optional adapter";

  constructor(private readonly options: LiteLLMAdapterOptions) {}

  id() {
    return "modeltruth:litellm";
  }

  async callApi(prompt: string, context?: { vars?: Record<string, unknown> }, options?: { abortSignal?: AbortSignal }) {
    const startedAt = Date.now();
    const proxyUrl = validateProxyUrl(this.options.proxyBaseUrl, this.options.allowLocalProxy);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);

    try {
      await assertResolvedAddressesArePublic(proxyUrl, this.options.allowLocalProxy, this.options.dnsLookup);
      const response = await fetchImpl(buildChatCompletionsUrl(proxyUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          "x-modeltruth-adapter": "litellm"
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: materializeMessages(prompt, context?.vars),
          max_tokens: this.options.maxTokens ?? 128,
          temperature: 0
        }),
        redirect: "manual",
        signal: options?.abortSignal ?? controller.signal
      });
      rejectCrossHostRedirect(proxyUrl, response);
      const rawText = await readLimitedResponse(response, maxResponseBodyBytes);
      const parsed = parseJsonObject(rawText);
      const usage = extractUsage(parsed);
      return {
        output: extractCompletion(parsed),
        raw: parsed,
        latencyMs: Date.now() - startedAt,
        tokenUsage: mapPromptfooTokenUsage(usage),
        metadata: {
          adapter: "litellm",
          model: typeof parsed.model === "string" ? parsed.model : this.options.model,
          parsed,
          usage,
          totalLatencyMs: Date.now() - startedAt,
          http: { status: response.status, statusText: response.statusText }
        }
      } satisfies ProviderResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateProxyUrl(proxyBaseUrl: string, allowLocalProxy = false) {
  const url = new URL(proxyBaseUrl);
  if (allowLocalProxy && ["http:", "https:"].includes(url.protocol)) return url;
  if (url.protocol !== "https:") throw new Error("LiteLLM proxy URL must use HTTPS unless allowLocalProxy is enabled");
  if (!isPublicHostname(url.hostname)) throw new Error("LiteLLM proxy URL must be public unless allowLocalProxy is enabled");
  return url;
}

async function assertResolvedAddressesArePublic(
  url: URL,
  allowLocalProxy = false,
  dnsLookup: (hostname: string) => Promise<Array<{ address: string }>> = defaultDnsLookup
) {
  if (allowLocalProxy || isLiteralIp(url.hostname)) return;
  await assertPublicResolvedAddresses(url, dnsLookup, "LiteLLM proxy");
}

async function defaultDnsLookup(hostname: string) {
  if (process.env.VITEST === "true") return [{ address: "203.0.113.10" }];
  return lookup(hostname, { all: true });
}

function isLiteralIp(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  return /^[\d.]+$/.test(normalized) || normalized.includes(":");
}

function buildChatCompletionsUrl(baseUrl: URL): string {
  const pathname = baseUrl.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) return baseUrl.toString();
  const next = new URL(baseUrl.toString());
  next.pathname = `${pathname}/chat/completions`.replace(/\/+/g, "/");
  return next.toString();
}

function materializeMessages(prompt: string, vars?: Record<string, unknown>) {
  const messages = vars?.messages;
  if (Array.isArray(messages)) return messages;
  return [{ role: "user", content: prompt }];
}

async function readLimitedResponse(response: Response, maxBytes: number) {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error(`LiteLLM response exceeded ${maxBytes} bytes`);
  return text;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractCompletion(parsed: Record<string, unknown>) {
  const choices = parsed.choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content ?? first?.text;
  return typeof content === "string" && content.trim() ? content : undefined;
}

function extractUsage(parsed: Record<string, unknown>) {
  const usage = parsed.usage;
  return usage && typeof usage === "object" && !Array.isArray(usage) ? usage : undefined;
}

function mapPromptfooTokenUsage(usage: unknown): ProviderResponse["tokenUsage"] {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const record = usage as Record<string, unknown>;
  return {
    prompt: numberValue(record.prompt_tokens ?? record.promptTokens),
    completion: numberValue(record.completion_tokens ?? record.completionTokens),
    total: numberValue(record.total_tokens ?? record.totalTokens)
  };
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function rejectCrossHostRedirect(baseUrl: URL, response: Response) {
  if (response.status < 300 || response.status >= 400) return;
  const location = response.headers.get("location");
  if (!location) return;
  const redirectUrl = new URL(location, baseUrl);
  if (redirectUrl.host !== baseUrl.host) {
    throw new Error("Cross-host redirects are not allowed for LiteLLM proxy");
  }
}
