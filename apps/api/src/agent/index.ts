import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createAgent from "./controllers/create-agent";
import deleteAgent from "./controllers/delete-agent";
import getAgents from "./controllers/get-agents";
import {
  agentMemberListSchema,
  createAgentResponseSchema,
  deleteAgentResponseSchema,
} from "./response";
import { agentIdParam, createAgentBody, workspaceIdQuery } from "./schema";

// Every route here is gated on workspace:manage_settings (admin/owner only),
// not the weaker member/invitation permissions the human-invite flow uses.
// Minting or revoking a credentialed, non-human identity is treated as an
// admin-tier operation uniformly across create/list/delete, rather than
// letting anyone who can invite a human also provision a bot.
const createAgentRoute = createRoute({
  method: "post",
  operationId: "createAgent",
  path: "/",
  tags: ["Agents"],
  summary: "Create agent member",
  description:
    "Create a non-human workspace member (no email/sign-up flow, no role choice -- every agent is created as a member) and mint an API key for it. The key is returned once and never stored in recoverable form.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createAgentBody } },
    },
  },
  responses: {
    200: jsonResponse("Agent created successfully", createAgentResponseSchema),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing workspace:manage_settings permission",
    ),
    502: errorResponse("Failed to provision the agent's API key"),
  },
});

const getAgentsRoute = createRoute({
  method: "get",
  operationId: "getAgents",
  path: "/",
  tags: ["Agents"],
  summary: "List agent members",
  description: "List all agent (non-human) members of a workspace.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("List of agent members", agentMemberListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing workspace:manage_settings permission",
    ),
  },
});

const deleteAgentRoute = createRoute({
  method: "delete",
  operationId: "deleteAgent",
  path: "/{id}",
  tags: ["Agents"],
  summary: "Revoke agent member",
  description:
    "Revoke an agent: delete its API key(s) and remove it from the workspace. The underlying user record is kept (detached, not deleted) so past comments and activity keep their author.",
  middleware: [
    workspaceAccess.fromAgentMember(),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  ] as const,
  request: { params: agentIdParam },
  responses: {
    200: jsonResponse("Agent revoked successfully", deleteAgentResponseSchema),
    400: errorResponse(
      "Unknown agent, or its workspace could not be determined",
    ),
    403: errorResponse(
      "No workspace access, or missing workspace:manage_settings permission",
    ),
    404: errorResponse("Agent not found in this workspace"),
  },
});

const agent = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(createAgentRoute, async (c) => {
    const { workspaceId, name } = c.req.valid("json");
    const result = await createAgent(workspaceId, name, c.get("userId"));
    return c.json(result, 200);
  })
  .openapi(getAgentsRoute, async (c) => {
    const agents = await getAgents(c.get("workspaceId"));
    return c.json(agents, 200);
  })
  .openapi(deleteAgentRoute, async (c) => {
    const { id } = c.req.valid("param");
    const result = await deleteAgent(id, c.get("workspaceId"), c.get("userId"));
    return c.json(result, 200);
  });

export default agent;
