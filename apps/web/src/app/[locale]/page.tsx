import { getDictionary, type Locale } from "@modeltruth/i18n";
import { getPublicAuditSummary } from "@modeltruth/db";

export default async function HomePage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  const summary = await getPublicAuditSummary();

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">{dictionary.home.eyebrow}</div>
          <h1>{dictionary.home.title}</h1>
          <p className="lede">{dictionary.home.lede}</p>
          <div className="actions">
            <a className="button" href={`/${locale}/playground`}>
              {dictionary.home.primaryCta}
            </a>
            <a className="button secondary" href={`/${locale}/methodology`}>
              {dictionary.home.secondaryCta}
            </a>
          </div>
        </div>
        <div className="card">
          <div className="eyebrow">{dictionary.home.truthBoard}</div>
          <div className="statusList">
            {dictionary.providers.map((provider) => (
              <div className="statusRow" key={provider.slug}>
                <span>{provider.name}</span>
                <span className={`pill ${provider.status}`}>{provider.status}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="metricGrid" aria-label={dictionary.home.metricsLabel}>
        <div className="metric">
          <strong>{summary.totalRuns}</strong>
          audit runs
        </div>
        <div className="metric">
          <strong>{Math.round(summary.passRate * 100)}%</strong>
          pass rate
        </div>
        <div className="metric">
          <strong>{summary.riskFlags.length}</strong>
          risk flags
        </div>
      </section>
    </>
  );
}
