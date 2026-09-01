import type { DefaultRoleName } from "@kaneo/permissions";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { auth } from "../../auth";
import db from "../../database";
import { userTable, workspaceUserTable } from "../../database/schema";

async function createAgent(
  workspaceId: string,
  name: string,
  role: DefaultRoleName = "member",
) {
  // agents.invalid uses the RFC 2606 reserved ".invalid" TLD: guaranteed
  // non-routable, so nothing ever emails it, and unambiguous in the DB as a
  // synthetic identity rather than a mistyped real address. userTable.email
  // is NOT NULL + UNIQUE, so a real value is required even though agents
  // never sign in with it; the per-agent createId() suffix is what keeps it
  // unique, not the (caller-supplied, unsanitized-for-uniqueness) name.
  const email = `agent-${createId()}@agents.invalid`;
  const joinedAt = new Date();

  const agent = await db.transaction(async (tx) => {
    // Direct insert, mirroring the anonymous() plugin's own pattern: a
    // userTable row created outside the normal sign-up flow. This
    // intentionally bypasses Better Auth's adapter/databaseHooks (the
    // registration-limit and first-user-admin-promotion checks in auth.ts),
    // which is correct here since neither applies to a workspace-scoped
    // bot identity that can only be created by an existing admin.
    const [inserted] = await tx
      .insert(userTable)
      .values({
        name,
        email,
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
      role,
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
      },
    });

    return {
      user: {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        role,
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
