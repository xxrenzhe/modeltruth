export interface NormalizedTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

export function normalizeUsage(value: unknown): NormalizedTokenUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const usage = {
    promptTokens: numberValue(record.promptTokens ?? record.prompt_tokens ?? record.input_tokens),
    completionTokens: numberValue(record.completionTokens ?? record.completion_tokens ?? record.output_tokens),
    totalTokens: numberValue(record.totalTokens ?? record.total_tokens),
    reasoningTokens: numberValue(record.reasoningTokens ?? record.reasoning_tokens)
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

export function usageCompletionTokenCount(usage: NormalizedTokenUsage | undefined): number | undefined {
  return usage?.completionTokens;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
