import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

export type CreateAgentRequest = InferRequestType<
  (typeof client)["agent"]["$post"]
>["json"];

async function createAgent({ workspaceId, name, role }: CreateAgentRequest) {
  const response = await client.agent.$post({
    json: { workspaceId, name, role },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default createAgent;
