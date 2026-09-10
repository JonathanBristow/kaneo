import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceUser,
  WorkspaceUserInvitation,
} from "@/types/workspace-user";
import MembersTable from "./members-table";

const copyToClipboard = vi.fn();
const success = vi.fn();
const error = vi.fn();

vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/format", () => ({
  formatDateMedium: () => "Sep 1, 2026",
}));

vi.mock("@/hooks/mutations/workspace-user/use-cancel-invitation", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/mutations/workspace-user/use-delete-workspace-user", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const deleteAgentMutateAsync = vi.fn();

vi.mock("@/hooks/mutations/agent/use-delete-agent", () => ({
  default: () => ({ mutateAsync: deleteAgentMutateAsync, isPending: false }),
}));

vi.mock(
  "@/hooks/mutations/workspace-user/use-update-workspace-user-role",
  () => ({
    default: () => ({ mutateAsync: vi.fn() }),
  }),
);

vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: [] }),
}));

const canInviteUsers = vi.fn(() => true);
const canManageWorkspace = vi.fn(() => true);

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageTeam: () => true,
    canRemoveMembers: () => true,
    canInviteUsers: () => canInviteUsers(),
    canManageWorkspace: () => canManageWorkspace(),
  }),
}));

vi.mock("../providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "current-user" } }),
}));

beforeEach(() => {
  canInviteUsers.mockReturnValue(true);
  canManageWorkspace.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pendingInvitation = {
  id: "invite-1",
  email: "invitee@example.com",
  role: "member",
  status: "pending",
  expiresAt: "2026-09-01T00:00:00.000Z",
} as unknown as WorkspaceUserInvitation;

describe("MembersTable pending invitation row menu", () => {
  it("copies the invitation link for that invitation when 'Copy link' is clicked", async () => {
    copyToClipboard.mockResolvedValue(true);

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.copyLink",
      }),
    );

    expect(copyToClipboard).toHaveBeenCalledWith(
      `${window.location.origin}/invitation/accept/invite-1`,
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:invitations.linkCopied"),
    );
  });

  it("still opens the cancel confirmation dialog instead of cancelling directly", async () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.cancelInvitation",
      }),
    );

    expect(
      await screen.findByText("team:membersTable.cancelDialogTitle"),
    ).toBeVisible();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("hides the row menu entirely when the user lacks canInvite", () => {
    canInviteUsers.mockReturnValue(false);

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    ).toBeNull();
  });
});

describe("MembersTable agent badge", () => {
  const agentMember = {
    id: "member-agent-1",
    userId: "user-agent-1",
    role: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
    user: {
      id: "user-agent-1",
      name: "Release Bot",
      // Real API responses return null here -- userTable.email is nullable
      // for agent rows.
      email: null,
      image: null,
    },
  } as unknown as WorkspaceUser;

  const humanMember = {
    id: "member-human-1",
    userId: "user-human-1",
    role: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
    user: {
      id: "user-human-1",
      name: "Jane Human",
      email: "jane@example.com",
      image: null,
    },
  } as unknown as WorkspaceUser;

  it("shows the agent badge only for member ids present in agentUserIds", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[]}
        users={[agentMember, humanMember]}
        agentUserIds={new Set(["user-agent-1"])}
      />,
    );

    expect(screen.getAllByText("team:members.agentBadge")).toHaveLength(1);
    expect(screen.getByText("Release Bot")).toBeVisible();
    expect(screen.getByText("Jane Human")).toBeVisible();
  });

  it("still badges an email-less row when agentUserIds is omitted", () => {
    // GET /agent 403s for anyone without workspace:manage_settings, so the
    // id set is simply absent for them. A member with no email can only be an
    // agent (the API requires one for every human), and that has to keep
    // working as the agent signal on its own.
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[]}
        users={[agentMember, humanMember]}
      />,
    );

    expect(screen.getAllByText("team:members.agentBadge")).toHaveLength(1);
    expect(screen.getByText("jane@example.com")).toBeVisible();
  });

  it("shows no email for an agent row, but still shows the human's email", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[]}
        users={[agentMember, humanMember]}
        agentUserIds={new Set(["user-agent-1"])}
      />,
    );

    expect(screen.getByText("jane@example.com")).toBeVisible();
    expect(screen.queryByText("agents.invalid", { exact: false })).toBeNull();
  });

  it("shows a dash instead of a role for an agent row, regardless of the stored role value", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[]}
        users={[agentMember, humanMember]}
        agentUserIds={new Set(["user-agent-1"])}
      />,
    );

    expect(screen.getByText("—")).toBeVisible();
    // The human row still shows its real role, proving the dash is
    // agent-specific rather than a global change to the Role column.
    expect(screen.getByText("team:roles.member")).toBeVisible();
  });
});

describe("MembersTable agent revoke", () => {
  const agentMember = {
    id: "member-agent-1",
    userId: "user-agent-1",
    role: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
    user: {
      id: "user-agent-1",
      name: "Release Bot",
      email: "agent-release-bot@agents.invalid",
      image: null,
    },
  } as unknown as WorkspaceUser;

  const humanMember = {
    id: "member-human-1",
    userId: "user-human-1",
    role: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
    user: {
      id: "user-human-1",
      name: "Jane Human",
      email: "jane@example.com",
      image: null,
    },
  } as unknown as WorkspaceUser;

  it("offers 'Revoke Agent' instead of 'Remove Member' on an agent row, and calls useDeleteAgent on confirm", async () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[]}
        users={[agentMember]}
        agentUserIds={new Set(["user-agent-1"])}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaRevokeAgent",
      }),
    );

    expect(
      screen.queryByRole("menuitem", {
        name: "team:membersTable.removeMember",
      }),
    ).toBeNull();

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.revokeAgent",
      }),
    );

    expect(
      await screen.findByText("team:membersTable.revokeDialogTitle"),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "team:membersTable.revokeAgent" }),
    );

    await waitFor(() =>
      expect(deleteAgentMutateAsync).toHaveBeenCalledWith({
        id: "user-agent-1",
      }),
    );
  });

  it("routes an email-less row through useDeleteAgent even when agentUserIds is unavailable", async () => {
    const emailLessAgent = {
      ...agentMember,
      user: { ...agentMember.user, email: null },
    } as unknown as WorkspaceUser;

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[]}
        users={[emailLessAgent]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaRevokeAgent",
      }),
    );

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.revokeAgent",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "team:membersTable.revokeAgent" }),
    );

    // The alternative -- falling through to the human path -- would hand
    // organization.removeMember a null email.
    await waitFor(() =>
      expect(deleteAgentMutateAsync).toHaveBeenCalledWith({
        id: "user-agent-1",
      }),
    );
  });

  it("never renders the generic remove-member action for an agent row, even when canRemoveMembers is true", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[]}
        users={[agentMember, humanMember]}
        agentUserIds={new Set(["user-agent-1"])}
      />,
    );

    // The human row still gets the generic action...
    expect(
      screen.getByRole("button", {
        name: "team:membersTable.ariaRemoveMember",
      }),
    ).toBeVisible();
    // ...but there is exactly one row menu trigger for the agent, and it's
    // the revoke-specific one, never the generic remove action.
    expect(
      screen.getByRole("button", { name: "team:membersTable.ariaRevokeAgent" }),
    ).toBeVisible();
  });

  it("hides the revoke action for an agent row when canManageWorkspace is false, even if canRemoveMembers is true", () => {
    canManageWorkspace.mockReturnValue(false);

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[]}
        users={[agentMember]}
        agentUserIds={new Set(["user-agent-1"])}
      />,
    );

    // The UI must never offer an action the server will 403.
    expect(
      screen.queryByRole("button", {
        name: "team:membersTable.ariaRevokeAgent",
      }),
    ).toBeNull();
  });

  it("shows key-invalidation copy in the confirmation dialog for an agent row", async () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[]}
        users={[agentMember]}
        agentUserIds={new Set(["user-agent-1"])}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaRevokeAgent",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.revokeAgent",
      }),
    );

    expect(
      await screen.findByText("team:membersTable.revokeDialogDescription"),
    ).toBeVisible();
    expect(
      screen.queryByText("team:membersTable.removeDialogDescription"),
    ).toBeNull();
  });
});
