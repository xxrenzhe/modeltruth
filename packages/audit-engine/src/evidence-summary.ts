import type { MaterializedPrompt } from "./prompt-materialization";
import type { AuditSuiteId } from "./types";

export function httpMetadata(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    status: typeof record.status === "number" ? record.status : 0,
    headers: record.headers && typeof record.headers === "object" && !Array.isArray(record.headers) ? record.headers : {}
  };
}

export function completionMetadata(parsed: Record<string, unknown>, completion: string | undefined, saveFullResponse = false) {
  const first = firstChoice(parsed);
  const safeFullResponse = safeFullResponseValue(completion, saveFullResponse);
  return {
    finishReason: stringValue(first?.finish_reason ?? first?.finishReason),
    responseExcerpt: safeResponseExcerpt(completion),
    responseExcerptPolicy: completion && completion.length <= 500 ? "omitted_full_completion" : "redacted_excerpt",
    fullResponse: safeFullResponse,
    fullResponseStored: Boolean(safeFullResponse),
    fullResponsePolicy: safeFullResponse ? "workspace_opt_in" : "not_stored"
  };
}

export function errorMetadata(parsed: Record<string, unknown>) {
  const error = parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error) ? (parsed.error as Record<string, unknown>) : undefined;
  return {
    errorCode: stringValue(error?.code ?? parsed.error_code ?? parsed.errorCode),
    errorType: stringValue(error?.type ?? parsed.error_type ?? parsed.errorType)
  };
}

export async function promptDiffSummary(suiteId: AuditSuiteId, materialized: MaterializedPrompt) {
  const userPrompt = [...materialized.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  return {
    suiteId,
    promptHashOnly: true,
    promptHash: await sha256(userPrompt),
    messageCount: materialized.messages.length,
    promptLength: userPrompt.length,
    expectedKeys: Object.keys(materialized.expected),
    contextTokenEstimate:
      typeof materialized.expected.contextTokenEstimate === "number" ? materialized.expected.contextTokenEstimate : undefined,
    needleDepths: Array.isArray(materialized.expected.needleDepths) ? materialized.expected.needleDepths : undefined,
    numericNoncePresent: Number.isFinite(materialized.numericNonce),
    timestampBucketPresent: Boolean(materialized.timestampBucket),
    syntheticNonceHashStored: true
  };
}

function firstChoice(parsed: Record<string, unknown>) {
  const choices = parsed.choices;
  return Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
}

function safeResponseExcerpt(completion: string | undefined) {
  if (!completion || completion.length <= 500 || looksLikeSecret(completion)) return undefined;
  return completion.slice(0, 500);
}

function safeFullResponseValue(completion: string | undefined, saveFullResponse: boolean) {
  if (!saveFullResponse || !completion || looksLikeSecret(completion)) return undefined;
  return completion;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function looksLikeSecret(value: string) {
  return /sk-[A-Za-z0-9_-]{8,}/.test(value) || /Bearer\s+\S+/i.test(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
