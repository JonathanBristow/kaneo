import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { auth } from "../../auth";
import { syncWorkspaceSeats } from "../../billing/controllers/sync-seats";
import db from "../../database";
import { userTable, workspaceUserTable } from "../../database/schema";

// 90 days: matches the longest preset already offered for personal keys
// (apps/web/src/components/settings/create-api-key-dialog.tsx). Long enough
// that automation isn't forced into disruptive re-provisioning cycles --
// there is no rotation UI, delete-and-recreate is the only path back -- short
// enough that a leaked or forgotten agent key doesn't stay valid forever.
export const AGENT_API_KEY_EXPIRES_IN_SECONDS = 90 * 24 * 60 * 60;

// Not a choice offered at creation: every agent gets this role, full stop.
// Letting an admin pick a role per agent implies each one needs its own
// deliberate permission review, which is more ceremony than a v1 automation
// identity warrants -- and it reopens the same "could this mint a second
// owner" question role selection already had to guard against. "member" is
// the least-surprising default: it can create/read tasks and comment, not
// touch workspace settings or other membership.
const AGENT_ROLE = "member";

async function createAgent(
  workspaceId: string,
  name: string,
  actorUserId?: string,
) {
  const joinedAt = new Date();

  const agent = await db.transaction(async (tx) => {
    // Direct insert, mirroring the anonymous() plugin's own pattern: a
    // userTable row created outside the normal sign-up flow. This
    // intentionally bypasses Better Auth's adapter/databaseHooks (the
    // registration-limit and first-user-admin-promotion checks in auth.ts),
    // which is correct here since neither applies to a workspace-scoped
    // bot identity that can only be created by an existing admin. email is
    // left null -- an agent never signs in, so there's nothing an email
    // would identify it to; the check constraint on userTable only requires
    // one for non-agent rows.
    const [inserted] = await tx
      .insert(userTable)
      .values({
        name,
        email: null,
        emailVerified: false,
        isAgent: true,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to create agent user");
    }

    await tx.insert(workspaceUserTable).values({
      workspaceId,
      userId: inserted.id,
      role: AGENT_ROLE,
      joinedAt,
    });

    return inserted;
  });

  try {
    // Server-side call (no `headers`), the same admin-on-behalf-of-userId
    // path already used by migrateOrganizations.ts. Delegating to Better
    // Auth's own endpoint (rather than hand-rolling the insert) keeps agent
    // keys byte-for-byte compatible with personal keys — same hash
    // algorithm, same `start`/`prefix` display convention — even if
    // better-auth changes its key format later. No `permissions` is passed,
    // so the key carries no scope of its own: authenticateApiRequest +
    // requireWorkspacePermission resolve it purely via referenceId -> this
    // agent's own workspace_member role, same as any personal key.
    const created = await auth.api.createApiKey({
      body: {
        userId: agent.id,
        name: `${name} (agent key)`,
        expiresIn: AGENT_API_KEY_EXPIRES_IN_SECONDS,
      },
    });

    // Fire-and-forget, mirroring afterAddMember in auth.ts -- agent creation
    // bypasses the organization plugin's own adapter path (this is a raw
    // insert), so that hook never fires for it and seat counts would
    // otherwise drift until the nightly reconciliation job catches it. A
    // no-op on self-hosted instances (syncWorkspaceSeats short-circuits when
    // billing is off).
    void syncWorkspaceSeats(workspaceId).catch((error) => {
      console.error("Seat sync after agent create failed:", error);
    });

    console.log("Agent created", {
      agentUserId: agent.id,
      workspaceId,
      role: AGENT_ROLE,
      createdBy: actorUserId,
    });

    return {
      user: {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        role: AGENT_ROLE,
        joinedAt,
      },
      apiKey: created.key,
    };
  } catch (error) {
    // No key means the agent is unusable. Better Auth's own createApiKey
    // insert isn't part of the transaction above (it runs through the
    // plugin's own adapter call, not this function's `tx`), so clean up by
    // compensation instead: delete the user, which cascades to its
    // workspace_member row (userId FK) and any apikey row that did get
    // created (referenceId FK) before rethrowing.
    await db.delete(userTable).where(eq(userTable.id, agent.id));
    console.error("Failed to mint API key for new agent:", error);
    throw new HTTPException(502, {
      message: "Failed to provision the agent's API key",
    });
  }
}

export default createAgent;
