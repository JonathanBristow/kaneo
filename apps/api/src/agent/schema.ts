import { z } from "../openapi";

export const agentIdParam = z.object({ id: z.string() });

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

// No role field: every agent is created with the same fixed role (see
// AGENT_ROLE in controllers/create-agent.ts), not a per-agent choice.
export const createAgentBody = z.object({
  workspaceId: z.string(),
  name: z.string().trim().min(1).max(191),
});
