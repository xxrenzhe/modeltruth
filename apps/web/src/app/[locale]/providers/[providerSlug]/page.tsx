import { getDictionary, type Locale } from "@modeltruth/i18n";
import { getPublicAuditSummary } from "@modeltruth/db";

export default async function ProviderPage({
  params
}: {
  params: Promise<{ locale: Locale; providerSlug: string }>;
}) {
  const { locale, providerSlug } = await params;
  const dictionary = getDictionary(locale);
  const provider =
    dictionary.providers.find((item) => item.slug === providerSlug) ?? dictionary.providers[0];
  const summary = await getPublicAuditSummary();

  return (
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
          <span className={`pill ${provider.status}`}>{provider.status}</span>
        </div>
        <div className="statusRow">
          <span>Audit pass rate</span>
          <strong>{Math.round(summary.passRate * 100)}%</strong>
        </div>
        <div className="statusRow">
          <span>P95 TTFT</span>
          <strong>{summary.p95TtftMs ?? "n/a"}ms</strong>
        </div>
        <div className="statusRow">
          <span>Risk flags</span>
          <strong>{summary.riskFlags.length}</strong>
        </div>
      </div>
    </section>
  );
}
