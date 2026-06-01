# ModelTruth Launch FAQ

## What does ModelTruth monitor?
ModelTruth monitors AI API availability, latency, model behavior consistency and billing evidence signals.

## Is ModelTruth a legal judgment system?
No. Public pages describe technical signals, confidence and repeatability rather than legal conclusions.

## Does the Free Playground store API keys?
No. Free Playground keys are used only for the current run and are not persisted.

## Can one failed run prove a provider is unreliable?
No. Public risk flags require repeatable signals or high-confidence retests.

## Which providers are included by default?
The public dashboard starts with OpenAI, Anthropic, Google Gemini and OpenRouter.

## Can teams add private endpoints?
Yes. Pro and Team workspaces can add encrypted private nodes for monitoring.

## Are raw prompts public?
No. Public evidence uses redacted summaries and hashes, not raw prompts or full completions.

## How does CLI upload work?
CLI upload requires explicit consent and sends redacted evidence only.

## What is the Evidence Score?
It is a compact score derived from coverage, confidence and recent risk rate.

## How fresh is dashboard data?
The release target is that public dashboard data is no more than 10 minutes behind the latest run.
