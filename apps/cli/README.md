# ModelTruth CLI

Local-first audit tool for OpenAI-compatible AI API endpoints.

## 3-minute quickstart

```bash
npm install -g modeltruth-cli
export OPENAI_API_KEY="sk-..."
modeltruth audit \
  --base-url https://api.example.com/v1 \
  --model gpt-5.1 \
  --suite smoke@1.0.0 \
  --output modeltruth-report.json
```

By default, the CLI runs locally and does not upload telemetry. The report stores redacted evidence only and never writes the API key.
If `--api-key`, `MODELTRUTH_API_KEY` and `OPENAI_API_KEY` are absent, the CLI prompts for the key interactively for the current run only.

The published npm package ships a bundled `dist/index.js` binary, so users do not need the ModelTruth monorepo or TypeScript tooling installed.

## Upload With Consent

```bash
modeltruth login --email you@example.com --api-base https://modeltruth.ai
modeltruth upload --run ./modeltruth-report.json --consent true
```

For a one-step audit plus upload:

```bash
modeltruth audit \
  --base-url https://api.example.com/v1 \
  --model gpt-5.1 \
  --consent-upload true \
  --api-base https://modeltruth.ai
```

Uploads require an authenticated session and explicit consent. Uploaded payloads include only redacted summary fields such as status, confidence, metrics, assertions and evidence summary.

## Withdraw CLI Upload State

```bash
modeltruth privacy-reset
```

This clears the local CLI session token and local audit activation history from `~/.modeltruth`. It does not contact ModelTruth servers; future uploads still require a fresh login and explicit `--consent true` or `--consent-upload true`.

## CTA

This endpoint passed the smoke audit. Keep it monitored 24/7:
https://modeltruth.ai/pro
