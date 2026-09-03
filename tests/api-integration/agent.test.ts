import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type CreateAgentResult = {
  user: {
    id: string;
    name: string;
    email: string | null;
    role: string;
    joinedAt: string;
  };
  apiKey: string;
};

async function postCreateAgent(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  body: Record<string, unknown> = {},
) {
  return app.request("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, name: "Release Bot", ...body }),
  });
}

async function seedTask(projectId: string, columnId: string | null) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: "Seeded task",
      status: "to-do",
      columnId,
      number: 1,
      position: 1,
    })
    .returning();
  if (!task) throw new Error("Failed to seed task");
  return task;
}

describe("API integration: agent members", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("POST /api/agent (create)", () => {
    it("allows an admin to create an agent with a null email and the fixed member role", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await postCreateAgent(app, admin.workspace.id);
      expect(response.status).toBe(200);
      const body = (await response.json()) as CreateAgentResult;

      expect(body.user.email).toBeNull();
      expect(body.user.role).toBe("member");
      expect(typeof body.apiKey).toBe("string");
      expect(body.apiKey.length).toBeGreaterThan(10);

      const userRow = await db.query.userTable.findFirst({
        where: eq(schema.userTable.id, body.user.id),
      });
      expect(userRow?.isAgent).toBe(true);
      expect(userRow?.email).toBeNull();

      const memberRow = await db.query.workspaceUserTable.findFirst({
        where: and(
          eq(schema.workspaceUserTable.userId, body.user.id),
          eq(schema.workspaceUserTable.workspaceId, admin.workspace.id),
        ),
      });
      expect(memberRow?.role).toBe("member");

      const keyRow = await db.query.apikeyTable.findFirst({
        where: eq(schema.apikeyTable.referenceId, body.user.id),
      });
      expect(keyRow).toBeDefined();
      expect(keyRow?.enabled).toBe(true);
      // The stored key is the hash, never the raw secret returned above.
      expect(keyRow?.key).not.toBe(body.apiKey);
    });

    it("ignores a role in the request body -- there is no per-agent choice", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await postCreateAgent(app, admin.workspace.id, {
        role: "admin",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as CreateAgentResult;
      // Whatever the caller sent, the agent still gets the fixed role --
      // createAgentBody no longer has a role field for zod to even parse.
      expect(body.user.role).toBe("member");
    });

    it("rejects a caller without workspace:manage_settings", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await postCreateAgent(app, member.workspace.id);
      expect(response.status).toBe(403);

      const agents = await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.isAgent, true));
      expect(agents).toHaveLength(0);
    });

    it("rejects an empty name", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await postCreateAgent(app, admin.workspace.id, {
        name: "   ",
      });
      expect(response.status).toBe(400);
    });
  });

  describe("agent api key authentication", () => {
    it("authenticates as the agent's own userId, not the creating admin's", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const createResponse = await postCreateAgent(app, admin.workspace.id);
      const { user: agentUser, apiKey } =
        (await createResponse.json()) as CreateAgentResult;

      const { project, columns } = await createProjectFixture({
        workspaceId: admin.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);

      // No session mock applies to this call: authenticateApiRequest checks
      // the x-api-key header before ever looking at a session/cookie.
      const commentResponse = await app.request(`/api/comment/${task.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ content: "hello from the agent" }),
      });
      expect(commentResponse.status).toBe(200);

      const persisted = await db.query.activityTable.findFirst({
        where: and(
          eq(schema.activityTable.taskId, task.id),
          eq(schema.activityTable.type, "comment"),
        ),
      });
      expect(persisted?.userId).toBe(agentUser.id);
      expect(persisted?.userId).not.toBe(admin.user.id);
    });

    it("limits the agent to the fixed member role's permissions and no more", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const createResponse = await postCreateAgent(app, admin.workspace.id);
      const { apiKey } = (await createResponse.json()) as CreateAgentResult;

      // member lacks workspace:manage_settings -- an agent can't mint
      // another agent, or do anything else this route requires.
      const createAnotherResponse = await app.request("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          workspaceId: admin.workspace.id,
          name: "second agent attempt",
        }),
      });
      expect(createAnotherResponse.status).toBe(403);

      // Listing workspace members has no permission gate beyond membership,
      // which the agent does have.
      const membersResponse = await app.request(
        `/api/workspace/${admin.workspace.id}/members`,
        { headers: { "x-api-key": apiKey } },
      );
      expect(membersResponse.status).toBe(200);
    });

    it("stops authenticating once the key has expired", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const createResponse = await postCreateAgent(app, admin.workspace.id);
      const { user: agentUser, apiKey } =
        (await createResponse.json()) as CreateAgentResult;

      await db
        .update(schema.apikeyTable)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.apikeyTable.referenceId, agentUser.id));

      const response = await app.request(
        `/api/workspace/${admin.workspace.id}/members`,
        { headers: { "x-api-key": apiKey } },
      );
      expect(response.status).toBe(401);
    });

    it("mints a key with a bounded default lifetime rather than one that never expires", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const beforeCreate = Date.now();
      const createResponse = await postCreateAgent(app, admin.workspace.id);
      const { user: agentUser } =
        (await createResponse.json()) as CreateAgentResult;

      const keyRow = await db.query.apikeyTable.findFirst({
        where: eq(schema.apikeyTable.referenceId, agentUser.id),
      });

      expect(keyRow?.expiresAt).toBeInstanceOf(Date);
      const expiresInDays =
        ((keyRow?.expiresAt?.getTime() ?? 0) - beforeCreate) /
        (24 * 60 * 60 * 1000);
      // Loose bound (89-91 days) so this isn't brittle against the small
      // amount of time the request itself takes.
      expect(expiresInDays).toBeGreaterThan(89);
      expect(expiresInDays).toBeLessThan(91);
    });
  });

  describe("GET /api/agent (list)", () => {
    it("lists only agent members for the workspace", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      await postCreateAgent(app, admin.workspace.id, { name: "Bot One" });

      const response = await app.request(
        `/api/agent?workspaceId=${admin.workspace.id}`,
      );
      expect(response.status).toBe(200);
      const agents = (await response.json()) as Array<{ name: string }>;
      expect(agents).toHaveLength(1);
      expect(agents[0]?.name).toBe("Bot One");
    });

    it("does not list agents from another workspace", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const other = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();
      await postCreateAgent(app, admin.workspace.id);

      mockAuthenticatedSession(other.user);
      const response = await app.request(
        `/api/agent?workspaceId=${other.workspace.id}`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
    });

    it("rejects a caller without workspace:manage_settings", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent?workspaceId=${member.workspace.id}`,
      );
      expect(response.status).toBe(403);
    });
  });

  describe("DELETE /api/agent/:id (revoke)", () => {
    it("revokes the key and membership but keeps the user row and its history", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const createResponse = await postCreateAgent(app, admin.workspace.id);
      const { user: agentUser, apiKey } =
        (await createResponse.json()) as CreateAgentResult;

      const { project, columns } = await createProjectFixture({
        workspaceId: admin.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id);
      await app.request(`/api/comment/${task.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ content: "left before being revoked" }),
      });

      const before = await app.request(
        `/api/workspace/${admin.workspace.id}/members`,
        { headers: { "x-api-key": apiKey } },
      );
      expect(before.status).toBe(200);

      const deleteResponse = await app.request(`/api/agent/${agentUser.id}`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toMatchObject({
        id: agentUser.id,
        email: agentUser.email,
      });

      // The key fails auth on its very next use.
      const after = await app.request(
        `/api/workspace/${admin.workspace.id}/members`,
        { headers: { "x-api-key": apiKey } },
      );
      expect(after.status).toBe(401);

      const memberRow = await db.query.workspaceUserTable.findFirst({
        where: eq(schema.workspaceUserTable.userId, agentUser.id),
      });
      expect(memberRow).toBeUndefined();

      const keys = await db
        .select()
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.referenceId, agentUser.id));
      expect(keys).toHaveLength(0);

      // Detached, not hard-deleted: the user row survives so the comment it
      // wrote earlier keeps a real author instead of cascading away.
      const userRow = await db.query.userTable.findFirst({
        where: eq(schema.userTable.id, agentUser.id),
      });
      expect(userRow?.isAgent).toBe(true);

      const comment = await db.query.activityTable.findFirst({
        where: and(
          eq(schema.activityTable.taskId, task.id),
          eq(schema.activityTable.type, "comment"),
        ),
      });
      expect(comment?.userId).toBe(agentUser.id);
    });

    it("returns 403 for a caller with no membership in the agent's workspace", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const foreign = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const createResponse = await postCreateAgent(app, admin.workspace.id);
      const { user: agentUser } =
        (await createResponse.json()) as CreateAgentResult;

      mockAuthenticatedSession(foreign.user);
      const response = await app.request(`/api/agent/${agentUser.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(403);

      const memberRow = await db.query.workspaceUserTable.findFirst({
        where: eq(schema.workspaceUserTable.userId, agentUser.id),
      });
      expect(memberRow).toBeDefined();
    });

    it("revokes the key even when removed via organization.removeMember directly, bypassing DELETE /api/agent/:id entirely", async () => {
      const { app } = createApp();

      // organization.remove-member is routed through auth.handler directly,
      // which resolves its own session from a real cookie -- it does not go
      // through authenticateApiRequest, so mockAuthenticatedSession (which
      // only stubs auth.api.getSession for OUR OWN routes) doesn't apply
      // here. A real sign-up + org-create round trip, exactly like
      // billing-delete-guard.test.ts, is what gets a cookie this endpoint
      // actually accepts.
      const signUp = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "owner@example.com",
          password: "correct horse battery staple",
          name: "Owner",
        }),
      });
      expect(signUp.status).toBe(200);
      const cookie = signUp.headers
        .getSetCookie()
        .map((entry) => entry.split(";")[0])
        .join("; ");

      const orgCreated = await app.request("/api/auth/organization/create", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "Bypass Test Space",
          slug: "bypass-test",
        }),
      });
      expect(orgCreated.status).toBe(200);
      const workspace = (await orgCreated.json()) as { id: string };

      const createResponse = await app.request("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          workspaceId: workspace.id,
          name: "Release Bot",
        }),
      });
      expect(createResponse.status).toBe(200);
      const { user: agentUser, apiKey } =
        (await createResponse.json()) as CreateAgentResult;

      // remove-member's memberIdOrEmail takes an email (the web app's own
      // human-removal path always sends one) OR the org-membership row's
      // own id -- never a user id. Agents have no email, so this has to be
      // the membership id.
      const membership = await db.query.workspaceUserTable.findFirst({
        where: and(
          eq(schema.workspaceUserTable.userId, agentUser.id),
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
        ),
      });

      // This is the org plugin's own generic member-removal endpoint --
      // the same one a human removal goes through, and the exact path this
      // hole allowed before afterRemoveMember's isAgent check was added in
      // apps/api/src/auth.ts. Never touches /api/agent.
      const removeResponse = await app.request(
        "/api/auth/organization/remove-member",
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            memberIdOrEmail: membership?.id,
            organizationId: workspace.id,
          }),
        },
      );
      expect(removeResponse.status).toBe(200);

      const keys = await db
        .select()
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.referenceId, agentUser.id));
      expect(keys).toHaveLength(0);

      const authResponse = await app.request(
        `/api/workspace/${workspace.id}/members`,
        { headers: { "x-api-key": apiKey } },
      );
      expect(authResponse.status).toBe(401);
    });

    it("will not resolve an ordinary member's id as an agent to delete", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const human = await createWorkspaceMember({ role: "member" });
      // Give the human a membership row in admin's own workspace, so the
      // lookup could plausibly match it if the isAgent filter were missing.
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: admin.workspace.id,
        userId: human.user.id,
        role: "member",
        joinedAt: new Date(),
      });

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      // Supply a workspaceId the admin genuinely manages via the query
      // fallback, so this exercises the controller's own isAgent check
      // rather than just the "workspace could not be determined" guard.
      const response = await app.request(
        `/api/agent/${human.user.id}?workspaceId=${admin.workspace.id}`,
        { method: "DELETE" },
      );
      expect(response.status).toBe(404);

      const stillThere = await db.query.workspaceUserTable.findFirst({
        where: and(
          eq(schema.workspaceUserTable.userId, human.user.id),
          eq(schema.workspaceUserTable.workspaceId, admin.workspace.id),
        ),
      });
      expect(stillThere).toBeDefined();
    });
  });
});
