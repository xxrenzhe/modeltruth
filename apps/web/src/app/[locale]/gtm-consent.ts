export const gtmConsentKey = "modeltruth.gtm.consent.v1";
export const gtmVisitorKey = "modeltruth.gtm.visitor.v1";

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export function hasGtmTelemetryConsent(storage: BrowserStorage = localStorage) {
  try {
    return storage.getItem(gtmConsentKey) === "granted";
  } catch {
    return false;
  }
}

export function grantGtmTelemetryConsent(storage: BrowserStorage = localStorage) {
  storage.setItem(gtmConsentKey, "granted");
}

export function getGtmVisitorId(storage: BrowserStorage = localStorage, randomId = () => crypto.randomUUID()) {
  try {
    const existing = storage.getItem(gtmVisitorKey);
    if (existing) return existing;
    const created = randomId();
    storage.setItem(gtmVisitorKey, created);
    return created;
  } catch {
    return randomId();
  }
}

export function classifyGtmSurface(pathname: string | null) {
  const path = pathname ?? "";
  if (path.includes("/providers/")) return "provider_board";
  if (path.includes("/playground")) return "playground";
  if (path.includes("/pricing")) return "pricing";
  if (/^\/(en|zh-CN|ja|ko|de|fr)$/.test(path) || path.endsWith("/methodology")) return "public_dashboard";
  return "site";
}
