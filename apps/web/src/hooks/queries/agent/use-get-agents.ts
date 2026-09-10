import { useQuery } from "@tanstack/react-query";
import getAgents from "@/fetchers/agent/get-agents";

// `enabled` is a real gate, not an optimization: GET /agent is served behind
// workspace:manage_settings, so callers that render for every workspace member
// must pass the same permission check the API enforces or the query 403s for
// most viewers.
function useGetAgents(workspaceId: string, options?: { enabled?: boolean }) {
  return useQuery({
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    queryKey: ["agents", workspaceId],
    queryFn: () => getAgents({ workspaceId }),
  });
}

export default useGetAgents;
