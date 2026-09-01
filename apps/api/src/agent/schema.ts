import { DEFAULT_ROLE_NAMES } from "@kaneo/permissions";
import { z } from "../openapi";

// viewer/member/admin only. "owner" is deliberately excluded: better-auth's
// organization plugin assumes exactly one owner per workspace (ownership
// change is its own explicit transfer flow), and DEFAULT_ROLE_NAMES is the
// same curated set the rest of the app already treats as "assignable"
// built-in roles for that reason.
const agentRole = z.enum(DEFAULT_ROLE_NAMES);

export const agentIdParam = z.object({ id: z.string() });

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const createAgentBody = z.object({
  workspaceId: z.string(),
  name: z.string().trim().min(1).max(191),
  role: agentRole.optional(),
});
