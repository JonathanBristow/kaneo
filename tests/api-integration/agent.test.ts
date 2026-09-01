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
    email: string;
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
    it("allows an admin to create an agent and returns a user and a raw api key", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await postCreateAgent(app, admin.workspace.id, {
        role: "viewer",
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as CreateAgentResult;

      expect(body.user.email).toMatch(/^agent-.+@agents\.invalid$/);
      expect(body.user.role).toBe("viewer");
      expect(typeof body.apiKey).toBe("string");
      expect(body.apiKey.length).toBeGreaterThan(10);

      const userRow = await db.query.userTable.findFirst({
        where: eq(schema.userTable.id, body.user.id),
      });
      expect(userRow?.isAgent).toBe(true);
      expect(userRow?.email).toBe(body.user.email);

      const memberRow = await db.query.workspaceUserTable.findFirst({
        where: and(
          eq(schema.workspaceUserTable.userId, body.user.id),
          eq(schema.workspaceUserTable.workspaceId, admin.workspace.id),
        ),
      });
      expect(memberRow?.role).toBe("viewer");

      const keyRow = await db.query.apikeyTable.findFirst({
        where: eq(schema.apikeyTable.referenceId, body.user.id),
      });
      expect(keyRow).toBeDefined();
      expect(keyRow?.enabled).toBe(true);
      // The stored key is the hash, never the raw secret returned above.
      expect(keyRow?.key).not.toBe(body.apiKey);
    });

    it("defaults to the member role when none is given", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await postCreateAgent(app, admin.workspace.id);
      expect(response.status).toBe(200);
      const body = (await response.json()) as CreateAgentResult;
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

    it("rejects role: owner (a workspace has exactly one owner)", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await postCreateAgent(app, admin.workspace.id, {
        role: "owner",
      });
      expect(response.status).toBe(400);
    });

    it("rejects an unknown role string", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await postCreateAgent(app, admin.workspace.id, {
        role: "superadmin",
      });
      expect(response.status).toBe(400);
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

      const createResponse = await postCreateAgent(app, admin.workspace.id, {
        role: "member",
      });
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

    it("limits the agent to its assigned role's permissions and no more", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const createResponse = await postCreateAgent(app, admin.workspace.id, {
        role: "viewer",
      });
      const { apiKey } = (await createResponse.json()) as CreateAgentResult;

      // viewer lacks project:create.
      const projectResponse = await app.request("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          name: "agent attempt",
          workspaceId: admin.workspace.id,
          slug: "AGT",
          icon: "Folder",
        }),
      });
      expect(projectResponse.status).toBe(403);

      // Listing workspace members has no permission gate beyond membership,
      // which the agent does have (as a viewer).
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

      const createResponse = await postCreateAgent(app, admin.workspace.id, {
        role: "member",
      });
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
