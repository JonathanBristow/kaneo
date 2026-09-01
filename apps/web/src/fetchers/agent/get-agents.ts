import { client } from "@kaneo/libs";

async function getAgents({ workspaceId }: { workspaceId: string }) {
  const response = await client.agent.$get({ query: { workspaceId } });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default getAgents;
