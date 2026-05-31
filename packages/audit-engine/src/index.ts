import { validatePublicHttpsUrl, type AuditStatus } from "@modeltruth/shared";
import { evaluateBillingVariance, type BillingSnapshot } from "./billing-variance";
import { completionMetadata, errorMetadata, httpMetadata, promptDiffSummary } from "./evidence-summary";
import { estimateModelCost } from "./model-pricing";
import { ModelTruthPromptfooProvider, runPromptfooMatrix } from "./promptfoo-runner";
import type { AuditSuiteDefinition, AuditSuiteId, ModelCapabilityProfile, SmokeAuditInput, SmokeAuditResult } from "./types";
import { normalizeUsage, usageCompletionTokenCount } from "./usage";
export type { LiteLLMAdapterOptions, ProviderAdapter } from "./litellm-adapter";
export { LiteLLMAdapter } from "./litellm-adapter";
export { estimateModelCost, findModelPricing, modelPricingTable } from "./model-pricing";
export type { CostEstimate, ModelPricingRecord, TokenUsageLike } from "./model-pricing";
export type { AuditSuiteDefinition, AuditSuiteId, ModelCapabilityProfile, SmokeAuditInput, SmokeAuditResult } from "./types";

const suiteRegistry: Record<AuditSuiteId, AuditSuiteDefinition> = {
  smoke: { suiteId: "smoke", suiteVersion: "1.0.0", public: true, maxTokens: 32 },
  "reasoning-lite": { suiteId: "reasoning-lite", suiteVersion: "1.0.0", public: false, maxTokens: 96 },
  "context-lite": { suiteId: "context-lite", suiteVersion: "1.0.0", public: false, maxTokens: 160 },
  "billing-lite": { suiteId: "billing-lite", suiteVersion: "1.0.0", public: false, maxTokens: 64 },
  "fingerprint-calibration": { suiteId: "fingerprint-calibration", suiteVersion: "1.0.0", public: false, maxTokens: 96 }
};

export function listAuditSuites(): AuditSuiteDefinition[] {
  return Object.values(suiteRegistry);
}

export function getAuditSuite(suiteId: string): AuditSuiteDefinition {
  const parsed = parseAuditSuiteId(suiteId);
  const suite = suiteRegistry[parsed.suiteId];
  if (parsed.suiteVersion !== suite.suiteVersion) {
    throw new Error(`Unsupported suite version: ${suiteId}`);
  }
  return suite;
}

export function parseAuditSuiteId(value: string): { suiteId: AuditSuiteId; suiteVersion: string } {
  const [rawSuiteId, suiteVersion = "1.0.0"] = value.split("@");
  if (!isAuditSuiteId(rawSuiteId)) throw new Error(`Unsupported audit suite: ${value}`);
  return { suiteId: rawSuiteId, suiteVersion };
}

export async function runAudit(input: SmokeAuditInput): Promise<SmokeAuditResult> {
  const suite = getAuditSuite(input.suiteId);
  if (!input.apiKey) {
    return buildResult("fail", Date.now(), 1, "AUTH_MISSING", "API key is required", suite);
  }
  return executeSuite(input, suite);
}

export async function runSmokeAudit(input: SmokeAuditInput): Promise<SmokeAuditResult> {
  return runAudit(input);
}

async function executeSuite(input: SmokeAuditInput, suite: AuditSuiteDefinition): Promise<SmokeAuditResult> {
  const startedAt = Date.now();
  const url = validateBaseUrl(input.baseUrl);
  await (input.requestLimiter ?? throttleAuditTarget)(url.host);
  const materialized = materializeSuitePrompt(suite.suiteId, input.nonceFactory?.());
  const requestStartedAt = Date.now();
  const traceId = input.traceId ?? createTraceId();

  try {
    const provider = new ModelTruthPromptfooProvider({
      baseUrl: url.toString(),
      apiKey: input.apiKey,
      model: input.model,
      maxTokens: suite.maxTokens,
      fetchImpl: input.fetchImpl,
      dnsLookup: input.dnsLookup,
      timeoutMs: input.timeoutMs
    });
    const [matrixResult] = await runPromptfooMatrix({
      provider,
      prompts: [
        {
          id: `${suite.suiteId}:primary`,
          raw: materialized.messages.at(-1)?.content ?? "",
          vars: { messages: materialized.messages }
        }
      ]
    });
    const ttftMs = Date.now() - requestStartedAt;
    const providerResponse = matrixResult.response;
    const completion = typeof providerResponse.output === "string" ? providerResponse.output : undefined;
    const usage = normalizeUsage(providerResponse.metadata?.usage);
    const parsed = parsedMetadata(providerResponse.metadata?.parsed);
    const http = httpMetadata(providerResponse.metadata?.http);
    const completionMeta = completionMetadata(parsed, completion, input.saveFullResponse);
    const errorMeta = errorMetadata(parsed);
    const statusCode = http.status;
    const assertions = await evaluateAssertions({
      suiteId: suite.suiteId,
      statusCode,
      completion,
      usage,
      materialized,
      modelProfile: input.modelProfile,
      billingSnapshot: input.billingSnapshot
    });
    const overallStatus = aggregateStatus(assertions);
    const totalLatencyMs = Date.now() - startedAt;
    const usageTokens = usageCompletionTokenCount(usage);
    const costEstimate = estimateModelCost({
      provider: input.modelProfile?.provider ?? providerSystemFromBaseUrl(url),
      modelId: input.model,
      usage
    });
    const billingVariance = suite.suiteId === "billing-lite" ? evaluateBillingVariance(input.billingSnapshot) : undefined;

    return {
      runId: crypto.randomUUID(),
      traceId,
      overallStatus,
      confidence: aggregateConfidence(assertions),
      metrics: {
        ttftMs,
        totalLatencyMs,
        statusCode,
        usage,
        costEstimate,
        billingVariance,
        tokensPerSecond: usageTokens ? usageTokens / Math.max(totalLatencyMs / 1000, 0.001) : undefined
      },
      assertions,
      evidenceSummary: {
        redaction: "applied",
        requestBodyStored: false,
        responseBodyStored: completionMeta.fullResponseStored,
        targetHostHash: await sha256(url.host),
        responseModel: typeof providerResponse.metadata?.model === "string" ? providerResponse.metadata.model : undefined,
        completionHash: completion ? await sha256(completion) : undefined,
        usage,
        costEstimate,
        billingVariance,
        suiteId: suite.suiteId,
        suiteVersion: suite.suiteVersion,
        promptNonceHash: await sha256(materialized.nonce),
        requestMetadata: {
          method: "POST",
          targetHostHash: await sha256(url.host),
          model: input.model,
          headers: ["authorization:redacted", "content-type"]
        },
        responseMetadata: {
          status: statusCode,
          headers: http.headers,
          usage,
          finishReason: completionMeta.finishReason,
          errorCode: errorMeta.errorCode,
          errorType: errorMeta.errorType
        },
        latencyTimeline: { requestStartOffsetMs: requestStartedAt - startedAt, ttftMs, totalLatencyMs },
        promptDiffSummary: await promptDiffSummary(suite.suiteId, materialized),
        responseExcerpt: completionMeta.responseExcerpt,
        responseExcerptPolicy: completionMeta.responseExcerptPolicy,
        fullResponse: completionMeta.fullResponse,
        fullResponseStored: completionMeta.fullResponseStored,
        fullResponsePolicy: completionMeta.fullResponsePolicy,
        finishReason: completionMeta.finishReason,
        errorCode: errorMeta.errorCode,
        errorType: errorMeta.errorType,
        traceparent: buildTraceparent(traceId),
        openInference: {
          "openinference.span.kind": "LLM",
          "llm.provider": input.modelProfile?.provider,
          "llm.model_name": input.model,
          "llm.system": providerSystemFromBaseUrl(url),
          "llm.invocation_parameters.max_tokens": suite.maxTokens,
          "llm.token_count.completion": usageCompletionTokenCount(usage),
          "modeltruth.suite_id": suite.suiteId,
          "modeltruth.suite_version": suite.suiteVersion,
          "modeltruth.provider_host_hash": await sha256(url.host)
        },
        modelRegistry: input.modelProfile
          ? {
              provider: input.modelProfile.provider,
              modelId: input.modelProfile.modelId,
              status: input.modelProfile.status,
              baselineSuiteVersion: input.modelProfile.baselineSuiteVersion,
              lastCalibratedAt: input.modelProfile.lastCalibratedAt
            }
          : undefined
      }
    };
  } catch (error) {
    return buildResult("error", startedAt, 0.75, "REQUEST_FAILED", error instanceof Error ? error.message : String(error), suite, traceId);
  }
}

function materializeSuitePrompt(suiteId: AuditSuiteId, fixedNonce?: string) {
  const nonce = fixedNonce ?? crypto.randomUUID();
  const numericNonce = 7919;
  if (suiteId === "reasoning-lite") {
    return {
      nonce,
      expected: { answer: String(17 * 23 + numericNonce) },
      messages: [
        { role: "system", content: "You are responding to a ModelTruth reasoning-lite audit. Return concise JSON only." },
        {
          role: "user",
          content: `Nonce ${nonce}. Compute 17 * 23 + ${numericNonce}. Return {"answer":"<number>","nonce":"${nonce}"}.`
        }
      ]
    };
  }
  if (suiteId === "context-lite") {
    const needles = [
      `needle_alpha=${nonce.slice(0, 8)}`,
      `needle_beta=${nonce.slice(9, 17)}`,
      `needle_gamma=${nonce.slice(18, 26)}`
    ];
    const filler = "ModelTruth synthetic context line. ".repeat(180);
    return {
      nonce,
      expected: { needles },
      messages: [
        { role: "system", content: "You are responding to a ModelTruth context-lite audit. Return concise JSON only." },
        {
          role: "user",
          content: `${filler}${needles[0]}\n${filler}${needles[1]}\n${filler}${needles[2]}\nReturn all three needle values and nonce ${nonce}.`
        }
      ]
    };
  }
  if (suiteId === "billing-lite") {
    return {
      nonce,
      expected: {},
      messages: [
        { role: "system", content: "You are responding to a ModelTruth billing-lite audit." },
        {
          role: "user",
          content: `Nonce ${nonce}. Reply with a short sentence containing the nonce. This run compares usage metadata with billing data when a balance source is configured.`
        }
      ]
    };
  }
  if (suiteId === "fingerprint-calibration") {
    return {
      nonce,
      expected: {},
      messages: [
        { role: "system", content: "You are responding to a ModelTruth fingerprint calibration audit." },
        {
          role: "user",
          content: `Nonce ${nonce}. Return concise JSON with keys model_family, capabilities, and nonce.`
        }
      ]
    };
  }
  return {
    nonce,
    expected: {},
    messages: [
      { role: "system", content: "You are responding to a ModelTruth smoke audit." },
      { role: "user", content: `Reply with exactly: modeltruth-smoke-${nonce}` }
    ]
  };
}

async function evaluateAssertions(input: {
  suiteId: AuditSuiteId;
  statusCode: number;
  completion?: string;
  usage: unknown;
  materialized: ReturnType<typeof materializeSuitePrompt>;
  modelProfile?: ModelCapabilityProfile;
  billingSnapshot?: BillingSnapshot;
}) {
  const assertions = [
    {
      id: "HTTP_STATUS_OK",
      status: input.statusCode >= 200 && input.statusCode < 300 ? "pass" : ("fail" as AuditStatus),
      confidence: 1,
      message: `Endpoint returned HTTP ${input.statusCode}`
    },
    {
      id: "COMPLETION_PRESENT",
      status: input.completion ? "pass" : ("warning" as AuditStatus),
      confidence: input.completion ? 0.9 : 0.5,
      message: input.completion ? "Completion text was present" : "Completion text was missing or unrecognized"
    },
    {
      id: "USAGE_PRESENT",
      status: input.usage ? "pass" : ("inconclusive" as AuditStatus),
      confidence: input.usage ? 0.8 : 0.4,
      message: input.usage ? "Token usage was reported" : "Token usage was not reported"
    }
  ];
  if (input.modelProfile) assertions.push(evaluateModelRegistry(input.modelProfile));
  if (input.suiteId === "reasoning-lite") assertions.push(evaluateReasoning(input.completion, input.materialized));
  if (input.suiteId === "reasoning-lite" && input.modelProfile && !input.modelProfile.supportsReasoningUsage) {
    assertions.push({
      id: "REASONING_USAGE_UNSUPPORTED",
      status: "inconclusive" as AuditStatus,
      confidence: 0.45,
      message: "Model registry marks reasoning usage as unsupported, so usage-based reasoning assertions are capped"
    });
  }
  if (input.suiteId === "context-lite") assertions.push(evaluateContext(input.completion, input.materialized));
  if (input.suiteId === "billing-lite") {
    assertions.push(evaluateBillingVarianceAssertion(input.billingSnapshot));
  }
  return assertions;
}

function evaluateBillingVarianceAssertion(snapshot: BillingSnapshot | undefined) {
  const variance = evaluateBillingVariance(snapshot);
  if (!variance) {
    return {
      id: "BILLING_BALANCE_SOURCE",
      status: "inconclusive" as AuditStatus,
      confidence: 0.65,
      message: "No balance source was configured, so billing variance cannot be confirmed"
    };
  }
  return {
    id: "BILLING_VARIANCE",
    status: variance.status,
    confidence: variance.status === "pass" ? 0.82 : variance.status === "warning" ? 0.78 : 0.88,
    message: `Billing variance ${(variance.varianceRatio * 100).toFixed(1)}% (${variance.direction})`
  };
}

function evaluateModelRegistry(profile: ModelCapabilityProfile) {
  if (profile.status === "deprecated") {
    return {
      id: "MODEL_REGISTRY_STATUS",
      status: "warning" as AuditStatus,
      confidence: 0.8,
      message: `Model registry marks ${profile.provider}/${profile.modelId} as deprecated`
    };
  }
  if (profile.status === "experimental") {
    return {
      id: "MODEL_REGISTRY_STATUS",
      status: "inconclusive" as AuditStatus,
      confidence: 0.55,
      message: `Model registry marks ${profile.provider}/${profile.modelId} as experimental pending calibration`
    };
  }
  return {
    id: "MODEL_REGISTRY_STATUS",
    status: "pass" as AuditStatus,
    confidence: 0.9,
    message: `Model registry marks ${profile.provider}/${profile.modelId} as stable`
  };
}

function evaluateReasoning(completion: string | undefined, materialized: ReturnType<typeof materializeSuitePrompt>) {
  const expected = materialized.expected as { answer?: string };
  const pass = Boolean(completion?.includes(expected.answer ?? "") && completion.includes(materialized.nonce));
  return {
    id: "REASONING_FINAL_ANSWER",
    status: pass ? ("pass" as AuditStatus) : ("fail" as AuditStatus),
    confidence: pass ? 0.86 : 0.72,
    message: pass ? "Reasoning-lite final answer and nonce matched" : "Reasoning-lite answer or nonce did not match"
  };
}

function evaluateContext(completion: string | undefined, materialized: ReturnType<typeof materializeSuitePrompt>) {
  const needles = ((materialized.expected as { needles?: string[] }).needles ?? []);
  const matches = needles.filter((needle) => completion?.includes(needle)).length;
  return {
    id: "CONTEXT_NEEDLE_RETRIEVAL",
    status: matches === needles.length ? ("pass" as AuditStatus) : matches >= 2 ? ("warning" as AuditStatus) : ("fail" as AuditStatus),
    confidence: matches === needles.length ? 0.84 : 0.7,
    message: `Context-lite retrieved ${matches}/${needles.length} synthetic needles`
  };
}

function aggregateStatus(assertions: Array<{ status: AuditStatus }>): AuditStatus {
  if (assertions.some((assertion) => assertion.status === "fail")) return "fail";
  if (assertions.some((assertion) => assertion.status === "error")) return "error";
  if (assertions.some((assertion) => assertion.status === "warning")) return "warning";
  if (assertions.every((assertion) => assertion.status === "inconclusive")) return "inconclusive";
  return assertions.some((assertion) => assertion.status === "inconclusive") ? "warning" : "pass";
}

function aggregateConfidence(assertions: Array<{ confidence: number }>) {
  if (assertions.length === 0) return 0;
  return Math.round((assertions.reduce((sum, assertion) => sum + assertion.confidence, 0) / assertions.length) * 100) / 100;
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

const targetAuditSlots = new Map<string, Promise<void>>();

async function throttleAuditTarget(targetHost: string) {
  const defaultIntervalMs = process.env.VITEST === "true" ? 0 : 1000;
  const minimumIntervalMs = Number(process.env.MODELTRUTH_AUDIT_TARGET_MIN_INTERVAL_MS ?? defaultIntervalMs);
  if (!Number.isFinite(minimumIntervalMs) || minimumIntervalMs <= 0) return;
  const normalizedHost = targetHost.toLowerCase();
  const previous = targetAuditSlots.get(normalizedHost) ?? Promise.resolve();
  let release = () => {};
  const current = previous
    .catch(() => undefined)
    .then(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
  targetAuditSlots.set(normalizedHost, current);
  await previous.catch(() => undefined);
  setTimeout(release, minimumIntervalMs).unref?.();
}

function parsedMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function buildResult(
  status: AuditStatus,
  startedAt: number,
  confidence: number,
  id: string,
  message: string,
  suite: AuditSuiteDefinition,
  traceId = createTraceId()
): SmokeAuditResult {
  return {
    runId: crypto.randomUUID(),
    traceId,
    overallStatus: status,
    confidence,
    metrics: { totalLatencyMs: Date.now() - startedAt },
    assertions: [{ id, status, confidence, message }],
    evidenceSummary: {
      redaction: "applied",
      requestBodyStored: false,
      suiteId: suite.suiteId,
      suiteVersion: suite.suiteVersion,
      traceparent: buildTraceparent(traceId),
      openInference: {
        "openinference.span.kind": "LLM",
        "modeltruth.suite_id": suite.suiteId,
        "modeltruth.suite_version": suite.suiteVersion
      }
    }
  };
}

function isAuditSuiteId(value: string): value is AuditSuiteId {
  return value in suiteRegistry;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createTraceId() {
  return crypto.randomUUID().replaceAll("-", "");
}

function buildTraceparent(traceId: string) {
  return `00-${traceId}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}-01`;
}

function providerSystemFromBaseUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host.includes("openai")) return "openai";
  if (host.includes("anthropic")) return "anthropic";
  if (host.includes("openrouter")) return "openrouter";
  if (host.includes("google") || host.includes("gemini")) return "google";
  return "openai-compatible";
}
