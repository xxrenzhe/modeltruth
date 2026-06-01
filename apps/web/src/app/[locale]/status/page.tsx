import { getDictionary, type Locale } from "@modeltruth/i18n";
import { getPublicAuditSummary } from "@modeltruth/db";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  buildSeoMetadata,
  datasetJsonLd,
  jsonLdScript,
  localizedPath
} from "@modeltruth/seo";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return buildSeoMetadata({
    locale,
    path: "/status",
    title: "AI API status and incident timeline | ModelTruth.ai",
    description:
      "Provider uptime summary, public risk signals and incident timeline generated from redacted ModelTruth audit evidence."
  });
}

export default async function StatusPage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  const summary = await getPublicAuditSummary();
  const statusUrl = absoluteUrl(localizedPath(locale, "/status"));
  const timeline = summary.riskFlags.slice(0, 8);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          datasetJsonLd(
            "ModelTruth public AI API status signals",
            "Redacted provider uptime summary and incident timeline from ModelTruth audit runs.",
            statusUrl
          )
        )}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(localizedPath(locale, "")) },
            { name: "Status", url: statusUrl }
          ])
        )}
      />
      <section className="hero">
        <div>
          <div className="eyebrow">Public Status</div>
          <h1>Provider uptime summary and incident timeline.</h1>
          <p className="lede">
            A lightweight status page for AI API buyers. It summarizes provider uptime,
            data freshness and repeated public risk signals without copying OpenStatus,
            Upptime or other status-page code.
          </p>
        </div>
        <div className="card">
          <div className="statusRow">
            <span>30d audit runs</span>
            <strong>{summary.totalRuns}</strong>
          </div>
          <div className="statusRow">
            <span>24h uptime</span>
            <strong>{Math.round(summary.windows["24h"].uptime * 100)}%</strong>
          </div>
          <div className="statusRow">
            <span>Public risk signals</span>
            <strong>{summary.riskFlags.length}</strong>
          </div>
          <div className="statusRow">
            <span>Data freshness</span>
            <strong>{summary.isFresh ? "fresh" : "stale"} / {formatFreshness(summary.dataFreshnessSeconds)}</strong>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="eyebrow">Provider uptime summary</div>
        <h2>Public provider health</h2>
        <div className="statusList">
          {dictionary.providers.map((provider) => {
            const providerSummary = summary.providers.find((item) => item.providerSlug === provider.slug);
            const window24h = providerSummary?.windows["24h"];
            const state = providerSummary
              ? providerSummary.riskFlags.length > 0 || (window24h?.uptime ?? 0) < 0.95
                ? "warning"
                : "pass"
              : provider.status;
            return (
              <div className="statusRow" key={provider.slug}>
                <span>{provider.name}</span>
                <span>
                  <strong>{window24h ? `${Math.round(window24h.uptime * 100)}%` : "n/a"}</strong>{" "}
                  <span className={`pill ${state}`}>{state}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="card">
        <div className="eyebrow">Incident timeline</div>
        <h2>Repeated public risk events</h2>
        <p className="lede">
          Timeline entries are generated from anonymized audit runs only after repeated evidence or
          high-confidence retest evidence. They are technical status signals, not legal conclusions.
        </p>
        {timeline.length === 0 ? (
          <p className="lede">No public incidents are currently visible.</p>
        ) : (
          <div className="statusList">
            {timeline.map((item) => (
              <article className="nodeCard" key={item.runId}>
                <div>
                  <strong>{item.providerSlug ?? "unknown provider"} / {item.suiteId}</strong>
                  <p>{new Date(item.createdAt).toISOString()} / run {item.runId}</p>
                </div>
                <span className={`pill ${item.status === "warning" ? "warning" : "fail"}`}>
                  {item.status}{item.riskFlagStatus ? ` / ${item.riskFlagStatus.replaceAll("_", " ")}` : ""}
                </span>
                <dl>
                  <div>
                    <dt>Model</dt>
                    <dd>{item.targetModelId}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{item.confidence ? `${Math.round(item.confidence * 100)}%` : "n/a"}</dd>
                  </div>
                  <div>
                    <dt>Run type</dt>
                    <dd>{item.runType}</dd>
                  </div>
                  <div>
                    <dt>Evidence</dt>
                    <dd>redacted audit summary</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function formatFreshness(seconds: number | undefined) {
  if (seconds === undefined) return "n/a";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}
