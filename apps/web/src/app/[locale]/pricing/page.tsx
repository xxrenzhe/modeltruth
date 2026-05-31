import type { Locale } from "@modeltruth/i18n";
import { buildSeoMetadata, faqPageJsonLd, jsonLdScript } from "@modeltruth/seo";
import { BillingCheckoutButton, BillingPortalButton } from "./billing-actions";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return buildSeoMetadata({
    locale,
    path: "/pricing",
    title: "AI API monitoring pricing | ModelTruth.ai",
    description:
      "Subscription pricing for AI API anti-cheat monitoring, private nodes, alerts and evidence exports."
  });
}

export default function PricingPage() {
  const plans = [
    { name: "Free", price: "$0", description: "Public dashboard and 3 playground audits per day.", tier: null },
    { name: "Pro Developer", price: "$19/mo", description: "3 nodes, evidence export and alerts.", tier: "pro" as const },
    { name: "Team", price: "$79/mo", description: "10 nodes, team members and priority support.", tier: "team" as const }
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          faqPageJsonLd([
            {
              question: "Does ModelTruth take supplier commission?",
              answer: "No. ModelTruth is a subscription SaaS and does not sell AI API traffic."
            },
            {
              question: "Are Playground API keys stored?",
              answer: "No. Free Playground keys are used only for the current audit run."
            }
          ])
        )}
      />
      <section className="metricGrid">
        {plans.map((plan) => (
          <div className="card formGrid" key={plan.name}>
            <div className="eyebrow">{plan.name}</div>
            <h1>{plan.price}</h1>
            <p className="lede">{plan.description}</p>
            {plan.tier ? <BillingCheckoutButton label={`Subscribe to ${plan.name}`} tier={plan.tier} /> : null}
          </div>
        ))}
      </section>
      <section className="actions">
        <BillingPortalButton label="Manage subscription" />
      </section>
    </>
  );
}
