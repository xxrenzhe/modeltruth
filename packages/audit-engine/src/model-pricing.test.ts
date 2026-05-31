import { describe, expect, it } from "vitest";
import { estimateModelCost, findModelPricing, modelPricingTable } from "./model-pricing";

describe("model pricing table", () => {
  it("keeps a Helicone-style provider/model cost table for billing estimates", () => {
    expect(modelPricingTable.map((record) => record.provider)).toEqual(
      expect.arrayContaining(["openai", "anthropic", "openrouter", "custom"])
    );
    expect(findModelPricing("openai", "gpt-5.1")).toMatchObject({
      provider: "openai",
      modelPattern: "gpt-5",
      currency: "USD"
    });
  });

  it("estimates token cost from OpenAI-compatible usage metadata", () => {
    const estimate = estimateModelCost({
      provider: "openai",
      modelId: "gpt-5.1",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000 }
    });

    expect(estimate).toMatchObject({
      provider: "openai",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      inputCostUsd: 1.25,
      outputCostUsd: 5,
      totalCostUsd: 6.25
    });
  });
});
