import { BillingCheckoutButton, BillingPortalButton } from "./billing-actions";

export default function PricingPage() {
  const plans = [
    { name: "Free", price: "$0", description: "Public dashboard and 3 playground audits per day.", tier: null },
    { name: "Pro Developer", price: "$19/mo", description: "3 nodes, evidence export and alerts.", tier: "pro" as const },
    { name: "Team", price: "$79/mo", description: "10 nodes, team members and priority support.", tier: "team" as const }
  ];

  return (
    <>
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
