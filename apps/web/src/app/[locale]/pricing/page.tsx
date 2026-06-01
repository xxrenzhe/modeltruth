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
      "Subscription pricing for AI API technical audit monitoring, private nodes, alerts and evidence exports."
  });
}

export default function PricingPage() {
  const plans = [
    {
      name: "Free",
      price: "$0",
      description: "Public dashboard, CLI local audits and 3 playground audits per day.",
      tier: null,
      features: [
        "Public Dashboard and Provider Truth Boards",
        "3 stateless Playground audits per day",
        "CLI local audit with upload disabled by default"
      ]
    },
    {
      name: "Pro Developer",
      price: "$19/mo",
      description: "Private monitoring for individual builders.",
      tier: "pro" as const,
      features: [
        "3 private provider nodes",
        "5 minute heartbeat monitoring",
        "12 hour deep audits",
        "2 encrypted alert channels",
        "Evidence export and monthly audit reports"
      ]
    },
    {
      name: "Team",
      price: "$79/mo",
      description: "Higher frequency monitoring and collaboration for small teams.",
      tier: "team" as const,
      features: [
        "10 private provider nodes",
        "1 minute heartbeat monitoring",
        "6 hour deep audits",
        "Team member invites",
        "Priority support and BYO regional probes"
      ]
    }
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
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            {plan.tier ? <BillingCheckoutButton label={`Subscribe to ${plan.name}`} tier={plan.tier} /> : null}
          </div>
        ))}
      </section>
      <section className="actions">
        <BillingPortalButton label="Manage subscription" />
      </section>
      <section className="card">
        <div className="eyebrow">Commercial independence</div>
        <h2>No paid ranking</h2>
        <p className="lede">
          ModelTruth does not take supplier commission, affiliate fees or paid placement for Provider Truth Boards.
          Subscriptions fund private monitoring; provider scoring remains separate from any future sponsored content.
        </p>
        <p className="lede">
          If audit cost exceeds fair-use limits, ModelTruth downshifts schedule frequency instead of selling supplier
          traffic or changing public rankings.
        </p>
      </section>
    </>
  );
}
