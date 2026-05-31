import type { AuditStatus } from "@modeltruth/shared";
import type { BillingVarianceResult } from "./billing-variance";

export type WeightedAssertion = {
  id: string;
  status: AuditStatus;
  confidence: number;
  message: string;
  weight?: number;
};

export type RetestRecommendation =
  | "none"
  | "manual_retest_recommended"
  | "automatic_retest_required"
  | "insufficient_signal_collect_more_samples";

const assertionWeights: Array<[RegExp, number]> = [
  [/HTTP|AUTH|STATUS|COMPLETION|USAGE/, 0.2],
  [/LATENCY|TTFT|THROUGHPUT/, 0.1],
  [/REASONING/, 0.25],
  [/FINGERPRINT|MODEL_REGISTRY/, 0.2],
  [/CONTEXT/, 0.15],
  [/BILLING/, 0.1]
];

export function aggregateStatus(assertions: Array<{ status: AuditStatus; confidence?: number }>): AuditStatus {
  const highConfidenceFailures = assertions.filter((assertion) => assertion.status === "fail" && (assertion.confidence ?? 0) >= 0.8);
  if (assertions.some((assertion) => assertion.status === "error")) return "error";
  if (highConfidenceFailures.length >= 2) return "fail";
  if (assertions.some((assertion) => assertion.status === "fail")) return "warning";
  if (assertions.some((assertion) => assertion.status === "warning")) return "warning";
  if (assertions.every((assertion) => assertion.status === "inconclusive")) return "inconclusive";
  return assertions.some((assertion) => assertion.status === "inconclusive") ? "warning" : "pass";
}

export function aggregateConfidence(assertions: WeightedAssertion[], suiteReliability = 0.95, sampleSizeFactor = 1) {
  if (assertions.length === 0) return 0;
  const weightedSum = assertions.reduce((sum, assertion) => sum + assertion.confidence * weightFor(assertion), 0);
  const totalWeight = assertions.reduce((sum, assertion) => sum + weightFor(assertion), 0);
  return roundConfidence((weightedSum / totalWeight) * suiteReliability * sampleSizeFactor);
}

export function withAssertionWeight<T extends WeightedAssertion>(assertion: T): T {
  return { ...assertion, weight: assertion.weight ?? inferWeight(assertion.id) };
}

export function buildRetestRecommendation(input: {
  overallStatus: AuditStatus;
  assertions: Array<{ status: AuditStatus }>;
  billingVariance?: BillingVarianceResult;
}): RetestRecommendation {
  if (input.billingVariance?.retestRequired) return "automatic_retest_required";
  if (input.overallStatus === "inconclusive" || input.assertions.every((assertion) => assertion.status === "inconclusive")) {
    return "insufficient_signal_collect_more_samples";
  }
  if (input.overallStatus === "warning" || input.overallStatus === "fail" || input.overallStatus === "error") {
    return "manual_retest_recommended";
  }
  return "none";
}

function weightFor(assertion: WeightedAssertion) {
  return assertion.weight ?? inferWeight(assertion.id);
}

function inferWeight(id: string) {
  return assertionWeights.find(([pattern]) => pattern.test(id))?.[1] ?? 0.1;
}

function roundConfidence(value: number) {
  return Math.round(Math.min(Math.max(value, 0), 1) * 100) / 100;
}
