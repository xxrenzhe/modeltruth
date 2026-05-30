import { NextResponse } from "next/server";
import { createBillingRepository } from "@modeltruth/db";
import { getCurrentSession } from "../../../../lib/auth";
import { createStripeCheckoutSession, type BillingTier } from "../../../../lib/stripe";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const tier = parseTier(body.tier);
    const billing = await createBillingRepository();
    try {
      const current = await billing.getWorkspaceBilling(session.workspace.id);
      const checkout = await createStripeCheckoutSession({
        tier,
        workspaceId: session.workspace.id,
        customerId: current?.stripeCustomerId,
        customerEmail: session.user.email,
        origin: new URL(request.url).origin
      });
      return NextResponse.json(checkout);
    } finally {
      await billing.close();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "checkout failed" }, { status: 400 });
  }
}

function parseTier(value: unknown): BillingTier {
  if (value === "team") return "team";
  if (value === "pro" || value === undefined) return "pro";
  throw new Error("unsupported billing tier");
}
