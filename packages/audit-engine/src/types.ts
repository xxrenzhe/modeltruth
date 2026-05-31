import type { AuditMetricSummary, AuditStatus } from "@modeltruth/shared";
import type { BillingSnapshot, BillingVarianceResult } from "./billing-variance";
import type { CostEstimate } from "./model-pricing";
import type { RetestRecommendation } from "./scoring";
import type { NormalizedTokenUsage } from "./usage";

export type AuditSuiteId = "smoke" | "reasoning-lite" | "context-lite" | "billing-lite" | "fingerprint-calibration";

export interface AuditSuiteDefinition {
  suiteId: AuditSuiteId;
  suiteVersion: string;
  public: boolean;
  maxTokens: number;
}

export interface SmokeAuditInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  suiteId: string;
  modelProfile?: ModelCapabilityProfile;
  billingSnapshot?: BillingSnapshot;
  saveFullResponse?: boolean;
  traceId?: string;
  fetchImpl?: typeof fetch;
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string }>>;
  timeoutMs?: number;
  nonceFactory?: () => string;
  requestLimiter?: (targetHost: string) => Promise<void>;
}

export interface ModelCapabilityProfile {
  provider: string;
  modelId: string;
  family: string;
  status: "experimental" | "stable" | "deprecated";
  supportsReasoningUsage: boolean;
  supportsStreaming: boolean;
  maxContextTokens?: number;
  baselineSuiteVersion: string;
  lastCalibratedAt?: string;
}

export interface SmokeAuditResult {
  runId: string;
  traceId: string;
  overallStatus: AuditStatus;
  confidence: number;
  metrics: AuditMetricSummary & {
    usage?: NormalizedTokenUsage;
    tokensPerSecond?: number;
    costEstimate?: CostEstimate;
    billingVariance?: BillingVarianceResult;
  };
  assertions: Array<{ id: string; status: AuditStatus; confidence: number; message: string; weight?: number }>;
  retestRecommendation: RetestRecommendation;
  evidenceSummary: {
    redaction: "applied";
    requestBodyStored: false;
    targetHostHash?: string;
    responseBodyStored?: boolean;
    responseModel?: string;
    completionHash?: string;
    usage?: NormalizedTokenUsage;
    costEstimate?: CostEstimate;
    billingVariance?: BillingVarianceResult;
    suiteId?: AuditSuiteId;
    suiteVersion?: string;
    promptNonceHash?: string;
    numericNonceHash?: string;
    timestampBucket?: string;
    retestRecommendation?: RetestRecommendation;
    requestMetadata?: Record<string, unknown>;
    responseMetadata?: Record<string, unknown>;
    latencyTimeline?: Record<string, number>;
    promptDiffSummary?: Record<string, unknown>;
    responseExcerpt?: string;
    responseExcerptPolicy?: string;
    fullResponse?: string;
    fullResponseStored?: boolean;
    fullResponsePolicy?: string;
    finishReason?: string;
    errorCode?: string;
    errorType?: string;
    traceparent?: string;
    openInference?: Record<string, string | number | boolean | undefined>;
    modelRegistry?: {
      provider: string;
      modelId: string;
      status: string;
      baselineSuiteVersion: string;
      lastCalibratedAt?: string;
    };
  };
}
