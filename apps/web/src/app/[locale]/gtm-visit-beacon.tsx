"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { classifyGtmSurface, getGtmVisitorId, grantGtmTelemetryConsent, hasGtmTelemetryConsent } from "./gtm-consent";

export function GtmVisitBeacon() {
  const pathname = usePathname();
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    setConsented(hasGtmTelemetryConsent());
  }, []);

  useEffect(() => {
    if (!consented) return;
    const surface = classifyGtmSurface(pathname);
    const visitorId = getGtmVisitorId();
    const body = JSON.stringify({ consent: true, surface, visitorId });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/gtm/visit", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/gtm/visit", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
  }, [consented, pathname]);

  if (consented) return null;
  return (
    <aside aria-label="Telemetry consent" className="gtmConsentBanner">
      <span>Help improve ModelTruth with anonymous visit telemetry. No API keys, prompts or completions are collected.</span>
      <button
        onClick={() => {
          grantGtmTelemetryConsent();
          setConsented(true);
        }}
        type="button"
      >
        Allow
      </button>
    </aside>
  );
}
