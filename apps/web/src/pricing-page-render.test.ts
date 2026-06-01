import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PricingPage from "./app/[locale]/pricing/page";

describe("pricing page runtime rendering", () => {
  it("renders the docs/plan commercial tiers with limits, monitoring cadence and independence language", () => {
    const html = renderToStaticMarkup(PricingPage());

    for (const required of [
      "Free",
      "$0",
      "Public Dashboard and Provider Truth Boards",
      "3 stateless Playground audits per day",
      "CLI local audit with upload disabled by default",
      "Pro Developer",
      "$19/mo",
      "3 private provider nodes",
      "5 minute heartbeat monitoring",
      "12 hour deep audits",
      "2 encrypted alert channels",
      "Evidence export and monthly audit reports",
      "Subscribe to Pro Developer",
      "Team",
      "$79/mo",
      "10 private provider nodes",
      "1 minute heartbeat monitoring",
      "6 hour deep audits",
      "Team member invites",
      "Priority support and BYO regional probes",
      "Subscribe to Team",
      "Manage subscription",
      "No paid ranking",
      "does not take supplier commission",
      "fair-use limits",
      "downshifts schedule frequency"
    ]) {
      expect(html).toContain(required);
    }

    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain("Does ModelTruth take supplier commission?");
    expect(html).not.toContain("affiliate ranking");
  });
});
