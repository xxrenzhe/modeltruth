import { createModelRegistryRepository, ensureDatabaseReady } from "@modeltruth/db";

const seedModels = [
  {
    provider: "openai",
    modelId: "gpt-5.1",
    family: "gpt-5",
    status: "experimental" as const,
    supportsReasoningUsage: true,
    supportsStreaming: true,
    maxContextTokens: 400000
  },
  {
    provider: "anthropic",
    modelId: "claude",
    family: "claude",
    status: "experimental" as const,
    supportsReasoningUsage: false,
    supportsStreaming: true
  },
  {
    provider: "openrouter",
    modelId: "openrouter-auto",
    family: "openrouter",
    status: "experimental" as const,
    supportsReasoningUsage: false,
    supportsStreaming: true
  }
];

await ensureDatabaseReady();
const repo = await createModelRegistryRepository();
try {
  for (const model of seedModels) {
    await repo.upsert(model);
  }
  console.log(`[seed-model-registry] upserted ${seedModels.length} experimental model entries`);
} finally {
  await repo.close();
}
