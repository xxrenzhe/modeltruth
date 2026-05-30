import { getDictionary, type Locale } from "@modeltruth/i18n";

export default async function HomePage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);

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
          <strong>24/7</strong>
          {dictionary.home.metricMonitoring}
        </div>
        <div className="metric">
          <strong>0%</strong>
          {dictionary.home.metricCommission}
        </div>
        <div className="metric">
          <strong>JSON</strong>
          {dictionary.home.metricEvidence}
        </div>
      </section>
    </>
  );
}
