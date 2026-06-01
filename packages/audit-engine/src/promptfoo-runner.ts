import { lookup } from "node:dns/promises";
import type { ApiProvider, ProviderResponse, VarValue } from "promptfoo";
import { assertPublicResolvedAddresses, validatePublicHttpsUrl } from "@modeltruth/shared";

const maxResponseBodyBytes = 2 * 1024 * 1024;
const defaultRequestTimeoutMs = 30_000;
const maxRequestTimeoutMs = 60_000;

export interface ModelTruthPromptfooProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  fetchImpl?: typeof fetch;
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string }>>;
  timeoutMs?: number;
}

export interface PromptfooMatrixInput {
  provider: ApiProvider;
  prompts: Array<{
    id: string;
    raw: string;
    vars?: Record<string, VarValue>;
  }>;
}

export interface PromptfooMatrixResult {
  promptId: string;
  response: ProviderResponse;
}

export class ModelTruthPromptfooProvider implements ApiProvider {
  label = "ModelTruth OpenAI-compatible provider";

  constructor(private readonly options: ModelTruthPromptfooProviderOptions) {}

  id() {
    return "modeltruth:openai-compatible";
  }

  async callApi(prompt: string, context?: { vars?: Record<string, unknown> }, options?: { abortSignal?: AbortSignal }) {
    const startedAt = Date.now();
    const url = validateBaseUrl(this.options.baseUrl);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalizeRequestTimeoutMs(this.options.timeoutMs));
    const abortSignal = combineAbortSignals(controller.signal, options?.abortSignal);

    try {
      await assertResolvedAddressesArePublic(url, this.options.dnsLookup);
      const response = await fetchImpl(buildChatCompletionsUrl(url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: materializeMessages(prompt, context?.vars),
          max_tokens: this.options.maxTokens,
          temperature: 0
        }),
        redirect: "manual",
        signal: abortSignal.signal
      });
      rejectCrossHostRedirect(url, response);
      const ttftMs = Date.now() - startedAt;
      const rawText = await readLimitedResponse(response, maxResponseBodyBytes);
      const parsed = parseJsonObject(rawText);
      const output = extractCompletion(parsed);
      const usage = extractUsage(parsed);
      return {
        output,
        raw: parsed,
        latencyMs: Date.now() - startedAt,
        tokenUsage: mapPromptfooTokenUsage(usage),
        metadata: {
          model: typeof parsed.model === "string" ? parsed.model : undefined,
          parsed,
          usage,
          ttftMs,
          totalLatencyMs: Date.now() - startedAt,
          http: {
            status: response.status,
            statusText: response.statusText,
            headers: allowlistHeaders(response.headers)
          }
        }
      } satisfies ProviderResponse;
    } finally {
      clearTimeout(timeout);
      abortSignal.cleanup();
    }
  }
}

export async function runPromptfooMatrix(input: PromptfooMatrixInput): Promise<PromptfooMatrixResult[]> {
  if (!isPromptfooProvider(input.provider)) throw new Error("Invalid promptfoo provider");
  const results: PromptfooMatrixResult[] = [];
  for (const prompt of input.prompts) {
    const response = await input.provider.callApi(prompt.raw, {
      vars: prompt.vars ?? {},
      prompt: { raw: prompt.raw, label: prompt.id }
    });
    results.push({ promptId: prompt.id, response });
  }
  return results;
}

function isPromptfooProvider(provider: unknown): provider is ApiProvider {
  return Boolean(provider && typeof provider === "object" && "id" in provider && "callApi" in provider);
}

function materializeMessages(prompt: string, vars?: Record<string, unknown>) {
  const messages = vars?.messages;
  if (Array.isArray(messages)) return messages;
  const systemPrompt = typeof vars?.systemPrompt === "string" ? vars.systemPrompt : undefined;
  return [systemPrompt ? { role: "system", content: systemPrompt } : undefined, { role: "user", content: prompt }].filter(Boolean);
}

function validateBaseUrl(baseUrl: string): URL {
  try {
    return validatePublicHttpsUrl(baseUrl, "Base URL");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("public endpoint")) throw new Error("Local or private endpoints are not allowed");
    throw error;
  }
}

async function assertResolvedAddressesArePublic(
  url: URL,
  dnsLookup: (hostname: string) => Promise<Array<{ address: string }>> = defaultDnsLookup
) {
  await assertPublicResolvedAddresses(url, dnsLookup, "Base URL");
}

async function defaultDnsLookup(hostname: string) {
  if (process.env.VITEST === "true") return [{ address: "203.0.113.10" }];
  return lookup(hostname, { all: true });
}

function buildChatCompletionsUrl(baseUrl: URL): string {
  const pathname = baseUrl.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) return baseUrl.toString();
  const next = new URL(baseUrl.toString());
  next.pathname = `${pathname}/chat/completions`.replace(/\/+/g, "/");
  return next.toString();
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error(`Response body exceeded ${maxBytes} bytes`);
    return text;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Response body exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(concatBytes(chunks, totalBytes));
}

function concatBytes(chunks: Uint8Array[], totalBytes: number) {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractCompletion(parsed: Record<string, unknown>): string | undefined {
  const choices = parsed.choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content ?? first?.text;
  return typeof content === "string" && content.trim() ? content : undefined;
}

function extractUsage(parsed: Record<string, unknown>): unknown {
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

function normalizeRequestTimeoutMs(timeoutMs: number | undefined) {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return defaultRequestTimeoutMs;
  return Math.min(Math.floor(timeoutMs), maxRequestTimeoutMs);
}

function combineAbortSignals(primary: AbortSignal, secondary?: AbortSignal) {
  if (!secondary) return { signal: primary, cleanup: () => undefined };
  const controller = new AbortController();
  const abort = () => controller.abort();
  primary.addEventListener("abort", abort, { once: true });
  secondary.addEventListener("abort", abort, { once: true });
  if (primary.aborted || secondary.aborted) abort();
  return {
    signal: controller.signal,
    cleanup() {
      primary.removeEventListener("abort", abort);
      secondary.removeEventListener("abort", abort);
    }
  };
}

function allowlistHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].filter(([key]) => isAllowedHeader(key)).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function isAllowedHeader(key: string) {
  const normalized = key.toLowerCase();
  return (
    ["content-type", "request-id", "x-request-id", "x-usage", "x-provider-usage"].includes(normalized) ||
    normalized.startsWith("rate-limit-") ||
    normalized.startsWith("x-ratelimit-")
  );
}

function rejectCrossHostRedirect(baseUrl: URL, response: Response) {
  if (response.status < 300 || response.status >= 400) return;
  const location = response.headers.get("location");
  if (!location) return;
  const redirectUrl = new URL(location, baseUrl);
  if (redirectUrl.host !== baseUrl.host) {
    throw new Error("Cross-host redirects are not allowed for audit endpoints");
  }
}
