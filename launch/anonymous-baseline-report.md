# Anonymous AI API Baseline Report

This report is the launch template for publishing anonymous ModelTruth baseline results without exposing customer endpoints, account identifiers, prompts, full completions or API keys.

## Scope

- Suites: `smoke@1.0.0`, `reasoning-lite@1.0.0`, `context-lite@1.0.0` and `billing-lite@1.0.0` where permitted.
- Providers: official model APIs and OpenAI-compatible gateways with user authorization.
- Evidence: run id, suite id/version, timestamp, status, confidence, latency buckets, usage metadata and redacted evidence summaries.

## Privacy Rules

- No raw endpoint path is published.
- No request headers are published.
- No request body, prompt or full completion is published.
- No workspace id, node id, email address or API key is published.
- Public examples use provider-level aggregates and anonymous evidence package hashes only.

## Launch Baseline Fields

| Field | Published format |
| --- | --- |
| Provider | Public provider slug or anonymized gateway cohort |
| Window | UTC date range |
| Suite coverage | Count by suite id/version |
| Availability | Pass/warning/fail/error aggregate |
| Latency | P50/P95 TTFT bucket |
| Billing consistency | Variance bucket, only when user-authorized |
| Evidence | Redacted run summary and evidence package hash |

## Release Criteria

- Every public risk statement must link to an anonymized audit run summary.
- Every suite version must have governance metadata and official baseline notes.
- Provider correction and dispute links must be visible from public pages.
- Legal copy must describe results as technical signals, not legal conclusions.
