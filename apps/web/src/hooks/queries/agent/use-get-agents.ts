import { useQuery } from "@tanstack/react-query";
import getAgents from "@/fetchers/agent/get-agents";

function useGetAgents(workspaceId: string) {
  return useQuery({
    enabled: Boolean(workspaceId),
    queryKey: ["agents", workspaceId],
    queryFn: () => getAgents({ workspaceId }),
  });
}

export default useGetAgents;
