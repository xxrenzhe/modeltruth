import { describe, expect, it } from "vitest";
import type { AuthSession } from "@modeltruth/db";
import { canExportMonthlyAuditReport } from "./lib/report-access";

describe("monthly report access", () => {
  it("allows Pro and Team workspaces but blocks Free", () => {
    expect(canExportMonthlyAuditReport(session("free"))).toBe(false);
    expect(canExportMonthlyAuditReport(session("pro"))).toBe(true);
    expect(canExportMonthlyAuditReport(session("team"))).toBe(true);
  });
});

function session(tier: string): AuthSession {
  return {
    id: "session_1",
    expiresAt: "2026-06-01T00:00:00.000Z",
    user: { id: "user_1", email: "user@example.com" },
    workspace: { id: "workspace_1", name: "Workspace", tier }
  };
}
