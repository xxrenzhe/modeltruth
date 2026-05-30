"use client";

import { useState } from "react";

export function BillingCheckoutButton({ tier, label }: { tier: "pro" | "team"; label: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function startCheckout() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Checkout failed");
      window.location.href = payload.url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Checkout failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button className="button" disabled={pending} onClick={startCheckout} type="button">
        {pending ? "..." : label}
      </button>
      {error ? <p className="notice error">{error}</p> : null}
    </>
  );
}

export function BillingPortalButton({ label }: { label: string }) {
  const [error, setError] = useState("");

  async function openPortal() {
    setError("");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Portal failed");
      window.location.href = payload.url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Portal failed");
    }
  }

  return (
    <>
      <button className="button secondary" onClick={openPortal} type="button">
        {label}
      </button>
      {error ? <p className="notice error">{error}</p> : null}
    </>
  );
}
