import { responseTimestamp, z } from "../openapi";

export const agentMemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string(),
    joinedAt: responseTimestamp,
  })
  .openapi("AgentMember");

export const agentMemberListSchema = z.array(agentMemberSchema);

export const createAgentResponseSchema = z
  .object({
    user: agentMemberSchema,
    // Only ever present on this one response. Nothing persists the raw key
    // server-side (the apikey table stores a SHA-256 hash), so a lost key
    // means deleting the agent and creating a new one.
    apiKey: z.string(),
  })
  .openapi("CreateAgentResponse");

export const deleteAgentResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  })
  .openapi("DeletedAgent");
