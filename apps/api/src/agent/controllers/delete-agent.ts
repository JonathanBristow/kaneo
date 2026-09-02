import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { syncWorkspaceSeats } from "../../billing/controllers/sync-seats";
import db from "../../database";
import {
  apikeyTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";

// Deleting an agent DETACHES rather than hard-deletes the underlying
// userTable row:
//   - all of the agent's api keys are deleted outright (not soft-disabled),
//     so an in-flight request with the old key fails its very next
//     verifyApiKey lookup
//   - its workspace_member row is removed, so requireWorkspacePermission has
//     no role left to resolve for it
//   - the userTable row itself (name, isAgent: true) is left in place
// The alternative -- hard-deleting the user row -- is what happens today for
// a human account via deleteAccountData, and it cascades: commentTable.userId
// is ON DELETE CASCADE, so every comment the account ever wrote would be
// deleted along with it. That tradeoff makes sense for a human-initiated
// "delete my account" request; it's a worse default for "revoke this bot's
// access", where the agent's comment/activity history on tasks is plausibly
// the whole point of having added it, and there's no equivalent "are you
// sure, this deletes N comments" confirmation in this prototype's UI. An
// orphaned isAgent user row with no workspace_member and no api keys is
// otherwise inert: it can't authenticate, can't be listed by GET /agent for
// any workspace, and (agents belong to exactly one workspace for their
// whole lifecycle in this prototype, with no re-invite flow) can never be
// reattached. It is a known, accepted piece of cruft for this pass -- see
// the feature's final report for the alternative considered.
async function deleteAgent(
  agentId: string,
  workspaceId: string,
  actorUserId?: string,
) {
  const [membership] = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .where(
      and(
        eq(workspaceUserTable.userId, agentId),
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(userTable.isAgent, true),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new HTTPException(404, {
      message: "Agent not found in this workspace",
    });
  }

  await db.transaction(async (tx) => {
    await tx.delete(apikeyTable).where(eq(apikeyTable.referenceId, agentId));
    await tx
      .delete(workspaceUserTable)
      .where(
        and(
          eq(workspaceUserTable.userId, agentId),
          eq(workspaceUserTable.workspaceId, workspaceId),
        ),
      );
  });

  // Fire-and-forget, mirroring afterRemoveMember in auth.ts -- this raw
  // delete bypasses the organization plugin's own adapter path, so that hook
  // never fires here. A no-op on self-hosted instances.
  void syncWorkspaceSeats(workspaceId).catch((error) => {
    console.error("Seat sync after agent revoke failed:", error);
  });

  console.log("Agent revoked", {
    agentUserId: agentId,
    workspaceId,
    revokedBy: actorUserId,
  });

  return membership;
}

export default deleteAgent;
