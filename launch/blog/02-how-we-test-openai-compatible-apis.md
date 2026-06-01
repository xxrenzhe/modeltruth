# How We Test OpenAI-Compatible APIs

ModelTruth starts with lightweight smoke checks and expands into reasoning, context and billing consistency suites. Each run records a suite version, run id, trace id, confidence score and redacted evidence summary.

Public risk flags require repeated signals or high-confidence retests. Private prompts, API keys and full responses are excluded from public evidence.
