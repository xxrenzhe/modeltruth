# Beta Transparency Changelog

This changelog is published with the beta launch and updated when ModelTruth changes public methodology, suite behavior, evidence retention, dispute handling or telemetry defaults.

## 2026-06-01 Beta Launch

### Methodology

- Public risk flags require repeated signals or a high-confidence run with retest evidence.
- Audit suites are versioned and governed through `packages/audit-engine/suite-governance.json`.
- Provider Truth Board pages show aggregate uptime, latency, evidence score, risk flags and dispute status.

### Privacy

- CLI telemetry remains off by default.
- CLI upload requires explicit `consent=true`.
- Playground API keys are used only for the current run and are not persisted.
- Public evidence excludes raw prompts, full completions, request bodies, authorization headers, raw endpoint paths and emails.

### Dispute Handling

- Providers can submit correction, response or takedown review requests through the public Dispute Policy.
- Dispute review jobs are queued and tracked with a 48-hour response target.
- Provider response status is displayed on Provider Truth Board pages after review intake.

### Known Limits

- Beta metrics are early technical signals, not endorsements or legal conclusions.
- Billing consistency checks require user authorization and may be unavailable for providers that do not expose usage metadata.
- Live smoke release gates require production secrets and are optional in local verification unless `MODELTRUTH_LIVE_SMOKE_REQUIRED=true`.
