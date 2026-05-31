export interface PublicTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

export function normalizePublicUsage(value: unknown): PublicTokenUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const usage = {
    promptTokens: numberValue(record.promptTokens ?? record.prompt_tokens ?? record.prompt),
    completionTokens: numberValue(record.completionTokens ?? record.completion_tokens ?? record.completion),
    totalTokens: numberValue(record.totalTokens ?? record.total_tokens ?? record.total),
    reasoningTokens: numberValue(record.reasoningTokens ?? record.reasoning_tokens ?? record.reasoning)
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
