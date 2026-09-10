import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AddAgentModal from "./add-agent-modal";

const copyToClipboard = vi.fn();
const success = vi.fn();
const error = vi.fn();
const createAgent = vi.fn();

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
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/hooks/mutations/agent/use-create-agent", () => ({
  default: () => ({ mutateAsync: createAgent, isPending: false }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function createAndReachKeyScreen() {
  createAgent.mockResolvedValue({
    user: { name: "Release Bot" },
    apiKey: "kaneo_agent_key",
  });

  render(<AddAgentModal open onClose={vi.fn()} workspaceId="workspace-1" />);

  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Release Bot" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "team:addAgentModal.create" }),
  );

  expect(await screen.findByText("kaneo_agent_key")).toBeVisible();
}

describe("AddAgentModal key copy", () => {
  it("marks the key as copied only when it actually reached the clipboard", async () => {
    copyToClipboard.mockResolvedValue(true);
    await createAndReachKeyScreen();

    fireEvent.click(
      screen.getByRole("button", { name: "team:addAgentModal.copy" }),
    );

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:addAgentModal.toastCopied"),
    );
    expect(
      screen.getByRole("button", { name: "team:addAgentModal.done" }),
    ).toBeEnabled();
  });

  it("reports a failed copy instead of pretending the key was saved", async () => {
    // No clipboard API at all (a self-hosted instance over plain HTTP) or a
    // denied permission: the key is shown exactly once, so claiming success
    // here would let it be dismissed and lost.
    copyToClipboard.mockResolvedValue(false);
    await createAndReachKeyScreen();

    fireEvent.click(
      screen.getByRole("button", { name: "team:addAgentModal.copy" }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("team:addAgentModal.copyError"),
    );
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByText("team:addAgentModal.copied")).toBeNull();
    // The key stays on screen to be copied by hand, and the dialog stops
    // holding the user hostage to a clipboard that cannot work.
    expect(screen.getByText("kaneo_agent_key")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "team:addAgentModal.done" }),
    ).toBeEnabled();
  });
});
