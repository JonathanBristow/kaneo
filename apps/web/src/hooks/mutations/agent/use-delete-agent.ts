import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteAgent from "@/fetchers/agent/delete-agent";

function useDeleteAgent(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", workspaceId] });
      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });
    },
  });
}

export default useDeleteAgent;
