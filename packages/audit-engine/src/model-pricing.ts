export interface ModelPricingRecord {
  provider: string;
  modelPattern: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  currency: "USD";
  source: "configured" | "helicone-style-reference";
  effectiveFrom: string;
}

export interface TokenUsageLike {
  prompt_tokens?: number;
  promptTokens?: number;
  completion_tokens?: number;
  completionTokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface CostEstimate {
  provider: string;
  modelPattern: string;
  currency: "USD";
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
}

export const modelPricingTable: ModelPricingRecord[] = [
  {
    provider: "openai",
    modelPattern: "gpt-5",
    inputUsdPerMillionTokens: 1.25,
    outputUsdPerMillionTokens: 10,
    currency: "USD",
    source: "configured",
    effectiveFrom: "2026-05-31"
  },
  {
    provider: "anthropic",
    modelPattern: "claude",
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
    currency: "USD",
    source: "configured",
    effectiveFrom: "2026-05-31"
  },
  {
    provider: "openrouter",
    modelPattern: "*",
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 3,
    currency: "USD",
    source: "helicone-style-reference",
    effectiveFrom: "2026-05-31"
  },
  {
    provider: "custom",
    modelPattern: "*",
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 3,
    currency: "USD",
    source: "helicone-style-reference",
    effectiveFrom: "2026-05-31"
  }
];

export function findModelPricing(provider: string | undefined, modelId: string): ModelPricingRecord | undefined {
  const normalizedProvider = (provider ?? "custom").toLowerCase();
  const normalizedModel = modelId.toLowerCase();
  const providerMatch = modelPricingTable.find(
    (record) =>
      record.provider === normalizedProvider &&
      (record.modelPattern === "*" || normalizedModel.startsWith(record.modelPattern.toLowerCase()))
  );
  if (providerMatch) return providerMatch;

  return (
    modelPricingTable.find(
      (record) => record.modelPattern !== "*" && normalizedModel.startsWith(record.modelPattern.toLowerCase())
    ) ?? modelPricingTable.find((record) => record.provider === "custom")
  );
}

export function estimateModelCost(input: {
  provider?: string;
  modelId: string;
  usage: unknown;
}): CostEstimate | undefined {
  const usage = parseUsage(input.usage);
  const pricing = findModelPricing(input.provider, input.modelId);
  if (!usage || !pricing) return undefined;
  const inputCostUsd = roundUsd((usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens);
  const outputCostUsd = roundUsd((usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens);
  return {
    provider: pricing.provider,
    modelPattern: pricing.modelPattern,
    currency: pricing.currency,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: roundUsd(inputCostUsd + outputCostUsd)
  };
}

function parseUsage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const usage = value as TokenUsageLike;
  const inputTokens = numberValue(usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens);
  const outputTokens = numberValue(usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function roundUsd(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
