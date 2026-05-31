import type { AuthSession } from "@modeltruth/db";

export function canExportMonthlyAuditReport(session: AuthSession) {
  return session.workspace.tier === "pro" || session.workspace.tier === "team";
}
