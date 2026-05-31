import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createAuthRepository } from "./auth";
import { createBillingRepository } from "./billing";
import { createWorkspaceMemberRepository } from "./workspace-members";

describe("WorkspaceMemberRepository", () => {
  it("invites a Team member and places their magic-link session in the invited workspace", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-members-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const ownerLink = await auth.createMagicLink("owner@example.com");
    const owner = await auth.consumeMagicLink(ownerLink.token);
    await auth.close();

    const billing = await createBillingRepository();
    await billing.updateWorkspaceBilling({
      workspaceId: owner!.session.workspace.id,
      subscriptionStatus: "active",
      tier: "team"
    });
    await billing.close();

    const members = await createWorkspaceMemberRepository();
    const ownerRole = await members.getRole(owner!.session.workspace.id, owner!.session.user.id);
    const invited = await members.invite({
      workspaceId: owner!.session.workspace.id,
      invitedByUserId: owner!.session.user.id,
      email: "Member@Example.com"
    });
    await members.close();

    const memberAuth = await createAuthRepository();
    const memberLink = await memberAuth.createMagicLink("member@example.com");
    const member = await memberAuth.consumeMagicLink(memberLink.token);
    await memberAuth.close();

    const refreshedMembers = await createWorkspaceMemberRepository();
    const list = await refreshedMembers.list(owner!.session.workspace.id);
    const memberRole = await refreshedMembers.getRole(owner!.session.workspace.id, member!.session.user.id);
    await refreshedMembers.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(ownerRole).toBe("owner");
    expect(memberRole).toBe("member");
    expect(invited.status).toBe("invited");
    expect(invited.email).toBe("member@example.com");
    expect(member?.session.workspace.id).toBe(owner?.session.workspace.id);
    expect(member?.session.workspace.tier).toBe("team");
    expect(list.map((entry) => [entry.email, entry.role, entry.status])).toEqual([
      ["owner@example.com", "owner", "active"],
      ["member@example.com", "member", "active"]
    ]);
  });
});
