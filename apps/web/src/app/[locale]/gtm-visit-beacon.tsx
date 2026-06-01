"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const visitorKey = "modeltruth.gtm.visitor.v1";

export function GtmVisitBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    const surface = classifySurface(pathname);
    const visitorId = getVisitorId();
    const body = JSON.stringify({ surface, visitorId });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/gtm/visit", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/gtm/visit", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
  }, [pathname]);

  return null;
}

function getVisitorId() {
  try {
    const existing = localStorage.getItem(visitorKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(visitorKey, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function classifySurface(pathname: string | null) {
  const path = pathname ?? "";
  if (path.includes("/providers/")) return "provider_board";
  if (path.includes("/playground")) return "playground";
  if (path.includes("/pricing")) return "pricing";
  if (path === "/en" || path === "/zh-CN" || path.endsWith("/methodology")) return "public_dashboard";
  return "site";
}
