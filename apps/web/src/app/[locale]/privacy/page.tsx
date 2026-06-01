import type { Locale } from "@modeltruth/i18n";
import { faqPageJsonLd, buildSeoMetadata, jsonLdScript } from "@modeltruth/seo";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return buildSeoMetadata({
    locale,
    path: "/privacy",
    title: "Privacy policy | ModelTruth.ai",
    description: "How ModelTruth handles API keys, audit evidence, telemetry and workspace data."
  });
}

export default async function PrivacyPage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          faqPageJsonLd([
            {
              question: "Does ModelTruth store Free Playground API keys?",
              answer: "No. Free Playground keys are used only for the current run and are not persisted."
            },
            {
              question: "Can users export or delete account data?",
              answer: "Yes. Privacy settings provide account export and account deletion workflows."
            }
          ])
        )}
      />
      <article className="card legalPage">
        <div className="eyebrow">Privacy</div>
        <h1>Keys are not telemetry.</h1>
        <p className="lede">
          Free Playground API keys are not persisted. Pro keys are encrypted at the
          application layer and only used for user-configured monitoring tasks.
        </p>
        <section>
          <h2>Data categories we collect</h2>
          <p>
            Notice at Collection: ModelTruth collects the categories below to provide the product,
            secure the service, process subscriptions and operate user-requested monitoring.
          </p>
          <ul>
            <li>Account information: email address, workspace membership and session metadata.</li>
            <li>Subscription information: Stripe customer, plan, checkout and billing portal metadata.</li>
            <li>Node configuration: provider name, Base URL, model id, schedule settings and encrypted API key ciphertext for Pro nodes.</li>
            <li>Audit metrics: suite id/version, status, confidence, latency, usage metadata, assertion summaries and redacted evidence hashes.</li>
            <li>Alert settings: webhook, Slack, Discord, Telegram or email targets stored encrypted or routed through configured processors.</li>
          </ul>
        </section>
        <section>
          <h2>Data we do not collect by default</h2>
          <ul>
            <li>Free Playground API keys are used only for the current run and are not written to the database or application logs.</li>
            <li>Complete request bodies, complete prompts and complete completions are not stored in evidence packages.</li>
            <li>Web visit telemetry is off by default until the visitor explicitly allows anonymous product metrics.</li>
            <li>CLI telemetry is off by default and upload requires explicit consent.</li>
          </ul>
        </section>
        <section>
          <h2>Purpose and legal basis</h2>
          <ul>
            <li>Provide API audit, monitoring, alerting and evidence export under contract performance.</li>
            <li>Operate abuse prevention, security monitoring, reliability and product integrity under legitimate interest.</li>
            <li>Process anonymous web visit telemetry only with opt-in consent; it records coarse surfaces, not raw paths, API keys, prompts or completions.</li>
            <li>Process CLI telemetry only with user consent, which can be withdrawn by disabling telemetry uploads.</li>
          </ul>
        </section>
        <section>
          <h2>Retention</h2>
          <div className="metricGrid legalGrid">
            <div className="metric">Free Playground runs: no raw content; anonymous metrics are aggregated or deleted within 24 hours.</div>
            <div className="metric">Opt-in web visit telemetry: stored as hashed visitor identifiers and coarse product surfaces for aggregated launch metrics.</div>
            <div className="metric">Pro evidence: retained for 30 days unless the user deletes related workspace data earlier.</div>
            <div className="metric">Aggregated metrics: retained up to 365 days after de-identification.</div>
            <div className="metric">Stripe billing metadata: retained according to Stripe, accounting and tax requirements.</div>
            <div className="metric">API key ciphertext: removed immediately when a node is deleted and cannot be recovered by ModelTruth.</div>
          </div>
        </section>
        <section>
          <h2>Processors and disclosures</h2>
          <p>
            ModelTruth may use Stripe, the production PostgreSQL hosting provider, ClawCloud/GHCR,
            email delivery providers, Telegram Bot API for Telegram alerts and user-configured alert channels. If Supabase, Cloudflare,
            Vercel or similar processors are added later, this policy must be updated before use.
          </p>
          <p>
            We do not sell personal information, and we do not share personal information for
            cross-context behavioral advertising. Public dashboards show aggregated or redacted
            technical evidence only, never user API keys, user accounts, full prompts or full completions.
          </p>
        </section>
        <section>
          <h2>Security incidents and key rotation</h2>
          <p>
            If API key exposure or evidence leakage cannot be ruled out, ModelTruth disables the affected audit path,
            reviews structured logs and evidence packages, notifies affected users to rotate keys and publishes an
            initial incident note within 24 hours when notice is required.
          </p>
        </section>
        <section>
          <h2>Your rights</h2>
          <p>
            You may request access, export or deletion from <a href={`/${locale}/settings/privacy`}>Privacy settings</a>.
            You may also contact compliance@modeltruth.ai for privacy requests or to withdraw CLI telemetry consent.
          </p>
        </section>
      </article>
    </>
  );
}
