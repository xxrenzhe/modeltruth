import type { AuditMetricSummary, AuditStatus } from "@modeltruth/shared";

export interface SmokeAuditInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  suiteId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface SmokeAuditResult {
  runId: string;
  overallStatus: AuditStatus;
  confidence: number;
  metrics: AuditMetricSummary;
  assertions: Array<{ id: string; status: AuditStatus; confidence: number; message: string }>;
  evidenceSummary: {
    redaction: "applied";
    requestBodyStored: false;
    targetHostHash?: string;
    responseBodyStored?: false;
    responseModel?: string;
    completionHash?: string;
    usage?: unknown;
  };
}

export async function runSmokeAudit(input: SmokeAuditInput): Promise<SmokeAuditResult> {
  const startedAt = Date.now();
  const url = validateBaseUrl(input.baseUrl);

  if (!input.apiKey) {
    return buildResult("fail", startedAt, 1, "AUTH_MISSING", "API key is required");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  const fetchImpl = input.fetchImpl ?? fetch;
  const requestStartedAt = Date.now();

  try {
    const response = await fetchImpl(buildChatCompletionsUrl(url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: "You are responding to a ModelTruth smoke audit." },
          { role: "user", content: `Reply with exactly: modeltruth-smoke-${crypto.randomUUID()}` }
        ],
        max_tokens: 32,
        temperature: 0
      }),
      signal: controller.signal
    });
    const ttftMs = Date.now() - requestStartedAt;
    const rawText = await readLimitedResponse(response, 64 * 1024);
    const parsed = parseJsonObject(rawText);
    const completion = extractCompletion(parsed);
    const usage = extractUsage(parsed);
    const status = response.ok && completion ? "pass" : response.ok ? "warning" : "fail";

    return {
      runId: crypto.randomUUID(),
      overallStatus: status,
      confidence: response.ok && completion ? 0.82 : 0.62,
      metrics: {
        ttftMs,
        totalLatencyMs: Date.now() - startedAt,
        statusCode: response.status
      },
      assertions: [
        {
          id: "HTTP_STATUS_OK",
          status: response.ok ? "pass" : "fail",
          confidence: 1,
          message: `Endpoint returned HTTP ${response.status}`
        },
        {
          id: "COMPLETION_PRESENT",
          status: completion ? "pass" : "warning",
          confidence: completion ? 0.9 : 0.5,
          message: completion ? "Completion text was present" : "Completion text was missing or unrecognized"
        },
        {
          id: "USAGE_PRESENT",
          status: usage ? "pass" : "inconclusive",
          confidence: usage ? 0.8 : 0.4,
          message: usage ? "Token usage was reported" : "Token usage was not reported"
        }
      ],
      evidenceSummary: {
        redaction: "applied",
        requestBodyStored: false,
        responseBodyStored: false,
        targetHostHash: await sha256(url.host),
        responseModel: typeof parsed.model === "string" ? parsed.model : undefined,
        completionHash: completion ? await sha256(completion) : undefined,
        usage
      }
    };
  } catch (error) {
    return buildResult("error", startedAt, 0.75, "REQUEST_FAILED", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

function validateBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") {
    throw new Error("Base URL must use HTTPS");
  }
  if (!isPublicHostname(url.hostname)) {
    throw new Error("Local or private endpoints are not allowed");
  }
  return url;
}

function buildChatCompletionsUrl(baseUrl: URL): string {
  const pathname = baseUrl.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) return baseUrl.toString();
  const next = new URL(baseUrl.toString());
  next.pathname = `${pathname}/chat/completions`.replace(/\/+/g, "/");
  return next.toString();
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(`Response body exceeded ${maxBytes} bytes`);
  }
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

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (["localhost", "metadata.google.internal"].includes(normalized)) return false;
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local")) return false;
  if (/^169\.254\./.test(normalized)) return false;
  if (/^10\./.test(normalized)) return false;
  if (/^127\./.test(normalized)) return false;
  if (/^192\.168\./.test(normalized)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return false;
  if (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  return true;
}

function buildResult(
  status: AuditStatus,
  startedAt: number,
  confidence: number,
  id: string,
  message: string
): SmokeAuditResult {
  return {
    runId: crypto.randomUUID(),
    overallStatus: status,
    confidence,
    metrics: {
      totalLatencyMs: Date.now() - startedAt
    },
    assertions: [{ id, status, confidence, message }],
    evidenceSummary: {
      redaction: "applied",
      requestBodyStored: false
    }
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
