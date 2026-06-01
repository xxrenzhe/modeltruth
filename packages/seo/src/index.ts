export const providers = ["openai", "anthropic", "google-gemini", "openrouter"] as const;
export type ProviderSlug = (typeof providers)[number];
export const comparePairs = ["openai-vs-anthropic", "openai-vs-openrouter", "openrouter-vs-official"] as const;

export function isKnownProviderSlug(value: string): value is ProviderSlug {
  return (providers as readonly string[]).includes(value);
}

export const guides = [
  {
    slug: "how-to-test-openai-compatible-api",
    title: "How to test an OpenAI-compatible API",
    description:
      "A step-by-step guide to testing OpenAI-compatible API availability, model behavior, latency and billing evidence."
  },
  {
    slug: "verify-openai-compatible-api",
    title: "How to verify an OpenAI-compatible API",
    description:
      "A practical checklist for testing availability, latency, model consistency and billing variance before production use."
  },
  {
    slug: "ai-api-billing-consistency",
    title: "How to audit AI API billing consistency",
    description:
      "Use usage signals, balance checks and repeatable probes to detect unexpected AI API billing variance."
  }
] as const;

export const publicPaths = [
  "",
  "/playground",
  ...providers.map((provider) => `/providers/${provider}`),
  "/status",
  "/methodology",
  "/pricing",
  "/privacy",
  "/settings/privacy",
  "/terms",
  "/dispute",
  "/evidence",
  ...comparePairs.map((pair) => `/compare/${pair}`),
  ...guides.map((guide) => `/guides/${guide.slug}`)
] as const;

export * from "./generateMetadata";
