export default function PricingPage() {
  return (
    <section className="metricGrid">
      {[
        ["Free", "$0", "Public dashboard and 3 playground audits per day."],
        ["Pro Developer", "$19/mo", "3 nodes, evidence export and alerts."],
        ["Team", "$79/mo", "10 nodes, team members and priority support."]
      ].map(([name, price, description]) => (
        <div className="card" key={name}>
          <div className="eyebrow">{name}</div>
          <h1>{price}</h1>
          <p className="lede">{description}</p>
        </div>
      ))}
    </section>
  );
}
