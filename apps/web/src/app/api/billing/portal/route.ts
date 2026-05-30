import { NextResponse } from "next/server";
import { createBillingRepository } from "@modeltruth/db";
import { getCurrentSession } from "../../../../lib/auth";
import { createStripePortalSession } from "../../../../lib/stripe";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const billing = await createBillingRepository();
  try {
    const current = await billing.getWorkspaceBilling(session.workspace.id);
    if (!current?.stripeCustomerId) {
      return NextResponse.json({ error: "workspace has no Stripe customer" }, { status: 409 });
    }
    const portal = await createStripePortalSession({
      customerId: current.stripeCustomerId,
      origin: new URL(request.url).origin
    });
    return NextResponse.json(portal);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "portal failed" }, { status: 400 });
  } finally {
    await billing.close();
  }
}
