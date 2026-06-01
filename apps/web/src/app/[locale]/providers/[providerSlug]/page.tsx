import { notFound } from "next/navigation";
import { getDictionary, type Locale } from "@modeltruth/i18n";
import { createProviderDisputeRepository, getPublicAuditSummary } from "@modeltruth/db";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  buildSeoMetadata,
  datasetJsonLd,
  jsonLdScript,
  localizedPath,
  isKnownProviderSlug,
  providers
} from "@modeltruth/seo";

export function generateStaticParams() {
  return providers.map((providerSlug) => ({ providerSlug }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale; providerSlug: string }>;
}) {
  const { locale, providerSlug } = await params;
  if (!isKnownProviderSlug(providerSlug)) notFound();
  const dictionary = getDictionary(locale);
  const provider = dictionary.providers.find((item) => item.slug === providerSlug)!;
  const title = `${provider.name} AI API Truth Board | ModelTruth.ai`;

  return buildSeoMetadata({
    locale,
    path: `/providers/${provider.slug}`,
    title,
    description: `Evidence-based uptime, TTFT, risk flags and audit pass-rate signals for ${provider.name}.`
  });
}

export default async function ProviderPage({
  params
}: {
  params: Promise<{ locale: Locale; providerSlug: string }>;
}) {
  const { locale, providerSlug } = await params;
  if (!isKnownProviderSlug(providerSlug)) notFound();
  const dictionary = getDictionary(locale);
  const provider = dictionary.providers.find((item) => item.slug === providerSlug)!;
  const summary = await getPublicAuditSummary({ providerSlug: provider.slug });
  const disputes = await listProviderDisputes(provider.slug);
  const providerUrl = absoluteUrl(localizedPath(locale, `/providers/${provider.slug}`));
  const window24h = summary.windows["24h"];
  const window7d = summary.windows["7d"];
  const window30d = summary.windows["30d"];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          datasetJsonLd(
            `${provider.name} AI API audit signals`,
            `Redacted ModelTruth audit aggregate for ${provider.name}.`,
            providerUrl
          )
        )}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(localizedPath(locale, "")) },
            { name: "Providers", url: absoluteUrl(localizedPath(locale, "/providers/openai")) },
            { name: provider.name, url: providerUrl }
          ])
        )}
      />
      <section className="hero">
        <div>
          <div className="eyebrow">Provider Truth Board</div>
          <h1>{provider.name}</h1>
          <p className="lede">
            Automated technical audit summary for uptime, latency, model consistency and
            billing variance. Results are evidence signals, not legal conclusions.
          </p>
        </div>
        <div className="card">
          <div className="statusRow">
            <span>Current risk state</span>
            <span className={`pill ${summary.riskFlags.length > 0 ? "warning" : provider.status}`}>
              {summary.riskFlags.length > 0 ? "warning" : provider.status}
            </span>
          </div>
          <div className="statusRow">
            <span>24h uptime</span>
            <strong>{Math.round(window24h.uptime * 100)}%</strong>
          </div>
          <div className="statusRow">
            <span>30d P95 TTFT</span>
            <strong>{summary.p95TtftMs ?? "n/a"}ms</strong>
          </div>
          <div className="statusRow">
            <span>Risk flags</span>
            <strong>{summary.riskFlags.length}</strong>
          </div>
          <div className="statusRow">
            <span>Evidence score</span>
            <strong>{summary.evidenceScore}</strong>
          </div>
          <div className="statusRow">
            <span>Data freshness</span>
            <strong>{summary.isFresh ? "fresh" : "stale"} / {formatFreshness(summary.dataFreshnessSeconds)}</strong>
          </div>
          <div className="statusRow">
            <span>Review status</span>
            <span className={`pill ${reviewStatusClass(disputes)}`}>
              {reviewStatusLabel(disputes)}
            </span>
          </div>
        </div>
      </section>
      <section className="metricGrid" aria-label={`${provider.name} audit trend windows`}>
        <div className="metric">
          <strong>{window24h.totalRuns}</strong>
          24h runs / {Math.round(window24h.passRate * 100)}% pass
        </div>
        <div className="metric">
          <strong>{window7d.totalRuns}</strong>
          7d runs / {Math.round(window7d.errorRate * 100)}% risk
        </div>
        <div className="metric">
          <strong>{window30d.totalRuns}</strong>
          30d runs / P50 {window30d.p50TtftMs ?? "n/a"}ms
        </div>
      </section>
      <section className="card">
        <div className="eyebrow">Provider risk alerts</div>
        <h2>Subscribe to Truth/Risk changes</h2>
        <p className="lede">
          Get a lightweight email when this provider moves into repeated public risk flags or when the weekly digest is ready.
        </p>
        <form className="formGrid" action="/api/providers/subscribe" method="post">
          <input name="providerSlug" type="hidden" value={provider.slug} />
          <label>
            Work email
            <input name="email" placeholder="you@example.com" required type="email" />
          </label>
          <label>
            Notification type
            <select name="notificationType" defaultValue="risk_trend">
              <option value="risk_trend">Truth/Risk trend changes</option>
              <option value="weekly_digest">Weekly provider digest</option>
            </select>
          </label>
          <button className="button primary" type="submit">Subscribe</button>
        </form>
      </section>
      <section className="card">
        <div className="eyebrow">Risk flags</div>
        <h2>Anonymous evidence trace</h2>
        <p className="lede">
          Each public flag links back to an anonymized audit run summary. Full prompts,
          completions, accounts and API keys are excluded from public evidence.
        </p>
        {summary.riskFlags.length === 0 ? (
          <p className="lede">No repeated public risk flags are currently visible for this provider.</p>
        ) : (
          <div className="statusList">
            {summary.riskFlags.map((flag) => (
              <article className="nodeCard" key={flag.runId}>
                <div>
                  <strong>{flag.runId}</strong>
                  <p>{flag.suiteId} / {flag.runType} / {new Date(flag.createdAt).toISOString()}</p>
                </div>
                <span className={`pill ${flag.status === "warning" ? "warning" : "fail"}`}>
                  {flag.status}{flag.riskFlagStatus ? ` / ${riskFlagStatusLabel(flag.riskFlagStatus)}` : ""}
                </span>
                <dl>
                  <div>
                    <dt>Model</dt>
                    <dd>{flag.targetModelId}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{flag.confidence ? `${Math.round(flag.confidence * 100)}%` : "n/a"}</dd>
                  </div>
                  <div>
                    <dt>Evidence</dt>
                    <dd>{compactEvidence(flag.evidenceSummary)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="card">
        <div className="eyebrow">Dispute review</div>
        <h2>Provider response status</h2>
        {disputes.length === 0 ? (
          <p className="lede">No provider disputes are currently attached to this public board.</p>
        ) : (
          <div className="statusList">
            {disputes.slice(0, 5).map((dispute) => (
              <div className="statusRow" key={dispute.id}>
                <span>
                  {requestTypeLabel(dispute.requestType)}: {dispute.runId ? `Run ${dispute.runId}` : "Provider submission"}
                </span>
                <span className={`pill ${disputeStatusClass(dispute.status)}`}>
                  {disputeStatusLabel(dispute.status)}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="lede">
          Providers may submit a correction, provider response or takedown review at{" "}
          <a href={`/${locale}/dispute`}>the dispute policy</a> using <code>POST /api/disputes</code>.
        </p>
      </section>
    </>
  );
}

async function listProviderDisputes(providerSlug: string) {
  const repo = await createProviderDisputeRepository();
  try {
    return await repo.listByProvider(providerSlug);
  } finally {
    await repo.close();
  }
}

function reviewStatusLabel(disputes: Awaited<ReturnType<typeof listProviderDisputes>>) {
  if (disputes.some((item) => item.status === "provider_response_attached")) return "Updated after review";
  if (disputes.some((item) => item.status === "resolved")) return "Resolved";
  if (disputes.some((item) => item.status === "under_review")) return "Under review";
  return "No active dispute";
}

function reviewStatusClass(disputes: Awaited<ReturnType<typeof listProviderDisputes>>) {
  if (disputes.some((item) => item.status === "provider_response_attached" || item.status === "resolved")) return "pass";
  if (disputes.some((item) => item.status === "under_review")) return "warning";
  return "muted";
}

function disputeStatusLabel(status: string) {
  if (status === "provider_response_attached") return "Updated after review";
  if (status === "resolved") return "Resolved";
  return "Under review";
}

function disputeStatusClass(status: string) {
  return status === "provider_response_attached" || status === "resolved" ? "pass" : "warning";
}

function requestTypeLabel(value: string | undefined) {
  if (value === "takedown") return "Takedown request";
  if (value === "provider_response") return "Provider response";
  return "Correction request";
}

function riskFlagStatusLabel(value: string) {
  if (value === "under_review") return "under review";
  return value.replaceAll("_", " ");
}

function formatFreshness(seconds: number | undefined) {
  if (seconds === undefined) return "n/a";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}

function compactEvidence(value: unknown) {
  const summary = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const parts = [
    typeof summary.suiteVersion === "string" ? `suite ${summary.suiteVersion}` : undefined,
    typeof summary.completionHash === "string" ? `completion ${summary.completionHash.slice(0, 10)}` : undefined,
    typeof summary.traceparent === "string" ? `trace ${summary.traceparent.slice(0, 18)}` : undefined,
    summary.externalProbe === true ? `probe ${String(summary.probeRegion ?? "regional")}` : undefined
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "redacted summary available";
}
