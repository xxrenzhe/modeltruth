"use client";

import { useEffect, useState } from "react";

interface EvidenceLabels {
  empty: string;
  download: string;
  riskFlags: string;
}

interface AuditRunListItem {
  runId: string;
  suiteId: string;
  runType: string;
  targetModelId: string;
  status: string;
  confidence?: number;
  metrics?: { ttftMs?: number; totalLatencyMs?: number; statusCode?: number };
  createdAt: string;
}

export function EvidenceClient({ labels }: { labels: EvidenceLabels }) {
  const [runs, setRuns] = useState<AuditRunListItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/evidence")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load evidence");
        setRuns(payload.runs ?? []);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load evidence"));
  }, []);

  const riskFlags = runs.filter((run) => ["warning", "fail", "error"].includes(run.status));

  return (
    <section className="workspaceGrid">
      <div className="card formGrid">
        <div className="eyebrow">{labels.riskFlags}</div>
        {riskFlags.length === 0 ? <p className="lede">{labels.empty}</p> : null}
        <div className="statusList">
          {riskFlags.map((run) => (
            <article className="nodeCard" key={run.runId}>
              <strong>{run.targetModelId}</strong>
              <span className={`pill ${run.status === "warning" ? "warning" : "fail"}`}>{run.status}</span>
              <p>{run.suiteId} / {run.runType}</p>
              <a className="button secondary" href={`/api/evidence/${run.runId}`}>
                {labels.download}
              </a>
            </article>
          ))}
        </div>
      </div>
      <div className="card formGrid">
        {error ? <p className="notice error">{error}</p> : null}
        {runs.length === 0 && !error ? <p className="lede">{labels.empty}</p> : null}
        <div className="statusList">
          {runs.map((run) => (
            <article className="nodeCard" key={run.runId}>
              <div>
                <strong>{run.runId}</strong>
                <p>{new Date(run.createdAt).toLocaleString()}</p>
              </div>
              <span className={`pill ${run.status === "pass" ? "pass" : run.status === "warning" ? "warning" : "fail"}`}>
                {run.status}
              </span>
              <dl>
                <div>
                  <dt>Model</dt>
                  <dd>{run.targetModelId}</dd>
                </div>
                <div>
                  <dt>HTTP</dt>
                  <dd>{run.metrics?.statusCode ?? "n/a"}</dd>
                </div>
                <div>
                  <dt>TTFT</dt>
                  <dd>{run.metrics?.ttftMs ?? "n/a"}ms</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{run.confidence ? `${Math.round(run.confidence * 100)}%` : "n/a"}</dd>
                </div>
              </dl>
              <a className="button secondary" href={`/api/evidence/${run.runId}`}>
                {labels.download}
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
