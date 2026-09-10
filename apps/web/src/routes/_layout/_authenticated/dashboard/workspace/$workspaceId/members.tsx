import { createFileRoute } from "@tanstack/react-router";
import { Bot, UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import AddAgentModal from "@/components/team/add-agent-modal";
import InviteTeamMemberModal from "@/components/team/invite-team-member-modal";
import MembersTable from "@/components/team/members-table";
import { Button } from "@/components/ui/button";
import useGetAgents from "@/hooks/queries/agent/use-get-agents";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/members",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const { data: workspace } = useGetFullWorkspace({ workspaceId });
  const { canInviteUsers, canManageWorkspace } = useWorkspacePermission();
  const canInvite = Boolean(canInviteUsers());
  // Gate the trigger the same way the API gates POST /agent
  // (workspace:manage_settings), so the button never promises an action the
  // server will 403.
  const canAddAgent = Boolean(canManageWorkspace());
  // GET /agent is gated on the same permission, so only fetch it for viewers
  // who would actually get a list back. Everyone else falls back to the
  // email-less signal in MembersTable.
  const { data: agents = [] } = useGetAgents(workspaceId, {
    enabled: canAddAgent,
  });
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isAddAgentOpen, setIsAddAgentOpen] = useState(false);
  const agentUserIds = new Set(agents.map((agent) => agent.id));

  return (
    <>
      <PageTitle title={t("team:members.pageTitle")} />
      <WorkspaceLayout
        title={t("team:members.pageTitle")}
        headerActions={
          <div className="flex items-center gap-2">
            {canAddAgent ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setIsAddAgentOpen(true)}
                className="gap-1"
              >
                <Bot className="w-3 h-3" />
                {t("team:members.addAgent")}
              </Button>
            ) : null}
            {canInvite ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setIsInviteOpen(true)}
                className="gap-1"
              >
                <UserPlus className="w-3 h-3" />
                {t("team:members.inviteMember")}
              </Button>
            ) : null}
          </div>
        }
      >
        <MembersTable
          workspaceId={workspaceId}
          users={workspace?.members ?? []}
          invitations={workspace?.invitations ?? []}
          agentUserIds={agentUserIds}
        />

        <InviteTeamMemberModal
          open={isInviteOpen}
          onClose={() => setIsInviteOpen(false)}
        />

        <AddAgentModal
          open={isAddAgentOpen}
          onClose={() => setIsAddAgentOpen(false)}
          workspaceId={workspaceId}
        />
      </WorkspaceLayout>
    </>
  );
}
