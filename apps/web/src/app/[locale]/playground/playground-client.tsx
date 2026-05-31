"use client";

import { useState } from "react";
import { validatePublicHttpsUrl } from "@modeltruth/shared";

type PlaygroundResult = {
  runId?: string;
  traceId?: string;
  overallStatus?: string;
  confidence?: number;
  metrics?: unknown;
  assertions?: unknown;
  evidenceSummary?: unknown;
  quota?: { remaining?: number; limit?: number };
};

export function PlaygroundClient() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PlaygroundResult | null>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError("");
    setResult(null);
    try {
      const baseUrl = String(formData.get("baseUrl") ?? "");
      validatePublicHttpsUrl(baseUrl, "Base URL");
      const response = await fetch("/api/playground/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          model: formData.get("model"),
          apiKey: formData.get("apiKey"),
          suiteId: formData.get("suiteId")
        })
      });
      const payload = (await response.json()) as PlaygroundResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Playground audit failed");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Playground audit failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card formGrid">
      <form className="formGrid" action={submit}>
        <label>
          Base URL
          <input name="baseUrl" placeholder="https://api.example.com/v1" required />
        </label>
        <label>
          Model
          <input name="model" placeholder="gpt-5.1" required />
        </label>
        <label>
          API key
          <input name="apiKey" placeholder="sk-..." required type="password" />
        </label>
        <label>
          Test suite
          <select name="suiteId" defaultValue="smoke@1.0.0">
            <option value="smoke@1.0.0">Smoke</option>
            <option value="reasoning-lite@1.0.0">Reasoning lite</option>
            <option value="context-lite@1.0.0">Context lite</option>
          </select>
        </label>
        <button className="button" disabled={pending} type="submit">
          {pending ? "Running..." : "Run audit"}
        </button>
      </form>
      <p className="muted">
        Frontend validation blocks non-HTTPS, localhost, private IP ranges and cloud metadata endpoints before any audit request is sent.
      </p>
      {error ? <p className="notice error">{error}</p> : null}
      {result ? (
        <div className="notice">
          <strong>{result.overallStatus ?? "completed"}</strong>
          <pre className="jsonPreview">{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  );
}
