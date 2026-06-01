import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyGtmSurface,
  getGtmVisitorId,
  grantGtmTelemetryConsent,
  gtmConsentKey,
  gtmVisitorKey,
  hasGtmTelemetryConsent
} from "./app/[locale]/gtm-consent";

describe("GTM telemetry consent", () => {
  it("defaults to no telemetry consent and stores consent separately from the visitor id", () => {
    const storage = memoryStorage();

    expect(hasGtmTelemetryConsent(storage)).toBe(false);
    expect(storage.getItem(gtmVisitorKey)).toBeNull();

    grantGtmTelemetryConsent(storage);

    expect(storage.getItem(gtmConsentKey)).toBe("granted");
    expect(storage.getItem(gtmVisitorKey)).toBeNull();
    expect(hasGtmTelemetryConsent(storage)).toBe(true);
  });

  it("creates a stable anonymous visitor id only after consent flow asks for one", () => {
    const storage = memoryStorage();
    const visitorId = getGtmVisitorId(storage, () => "visitor-123");

    expect(visitorId).toBe("visitor-123");
    expect(getGtmVisitorId(storage, () => "visitor-456")).toBe("visitor-123");
  });

  it("keeps the visit beacon from creating visitor ids or sending telemetry before opt-in", () => {
    const source = readFileSync("apps/web/src/app/[locale]/gtm-visit-beacon.tsx", "utf8");
    const consentGuardIndex = source.indexOf("if (!consented) return;");
    const visitorIndex = source.indexOf("getGtmVisitorId()");
    const consentPayloadIndex = source.indexOf("consent: true");

    expect(consentGuardIndex).toBeGreaterThan(0);
    expect(visitorIndex).toBeGreaterThan(consentGuardIndex);
    expect(consentPayloadIndex).toBeGreaterThan(visitorIndex);
  });

  it("classifies only coarse surfaces instead of raw paths", () => {
    expect(classifyGtmSurface("/en/providers/openai")).toBe("provider_board");
    expect(classifyGtmSurface("/en/playground")).toBe("playground");
    expect(classifyGtmSurface("/en/pricing")).toBe("pricing");
    expect(classifyGtmSurface("/en")).toBe("public_dashboard");
    expect(classifyGtmSurface("/en/guides/how-to-test-openai-compatible-api")).toBe("site");
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
}
