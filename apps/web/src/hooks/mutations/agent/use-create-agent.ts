import { useMutation, useQueryClient } from "@tanstack/react-query";
import createAgent from "@/fetchers/agent/create-agent";

function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createAgent,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["agents", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", variables.workspaceId],
      });
    },
  });
}

export default useCreateAgent;
