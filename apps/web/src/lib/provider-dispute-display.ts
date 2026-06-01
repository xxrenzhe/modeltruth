import type { ProviderDisputeRecord, ProviderDisputeStatus } from "@modeltruth/db";

export function reviewStatusLabel(disputes: Pick<ProviderDisputeRecord, "status">[]) {
  if (disputes.some((item) => item.status === "provider_response_attached")) return "Updated after review";
  if (disputes.some((item) => item.status === "resolved")) return "Resolved";
  if (disputes.some((item) => item.status === "under_review")) return "Under review";
  return "No active dispute";
}

export function reviewStatusClass(disputes: Pick<ProviderDisputeRecord, "status">[]) {
  if (disputes.some((item) => item.status === "provider_response_attached" || item.status === "resolved")) {
    return "pass";
  }
  if (disputes.some((item) => item.status === "under_review")) return "warning";
  return "muted";
}

export function disputeStatusLabel(status: ProviderDisputeStatus) {
  if (status === "provider_response_attached") return "Updated after review";
  if (status === "resolved") return "Resolved";
  return "Under review";
}

export function disputeStatusClass(status: ProviderDisputeStatus) {
  return status === "provider_response_attached" || status === "resolved" ? "pass" : "warning";
}

export function requestTypeLabel(value: string | undefined) {
  if (value === "takedown") return "Takedown request";
  if (value === "provider_response") return "Provider response";
  return "Correction request";
}
