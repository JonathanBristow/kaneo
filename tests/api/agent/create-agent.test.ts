import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockTransaction = vi.fn();
const mockDelete = vi.fn();
const mockCreateApiKey = vi.fn();
const mockSyncWorkspaceSeats = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

vi.mock("../../../apps/api/src/auth", () => ({
  auth: {
    api: {
      createApiKey: (...args: unknown[]) => mockCreateApiKey(...args),
    },
  },
}));

vi.mock("../../../apps/api/src/billing/controllers/sync-seats", () => ({
  syncWorkspaceSeats: (...args: unknown[]) => mockSyncWorkspaceSeats(...args),
}));

import createAgent, {
  AGENT_API_KEY_EXPIRES_IN_SECONDS,
} from "../../../apps/api/src/agent/controllers/create-agent";

const INSERTED_USER = {
  id: "agent-user-1",
  name: "Release Bot",
  email: null,
  isAgent: true,
};

function makeTx() {
  const userValues = vi.fn(() => ({
    returning: vi.fn(() => Promise.resolve([INSERTED_USER])),
  }));
  const memberValues = vi.fn(() => Promise.resolve(undefined));
  let callCount = 0;
  const tx = {
    insert: vi.fn(() => {
      callCount += 1;
      return { values: callCount === 1 ? userValues : memberValues };
    }),
  };
  return { tx, userValues, memberValues };
}

describe("createAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncWorkspaceSeats.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a null email and the fixed member role, and returns the minted key", async () => {
    const { tx, userValues, memberValues } = makeTx();
    mockTransaction.mockImplementation(async (cb) => cb(tx));
    mockCreateApiKey.mockResolvedValue({ key: "raw-agent-key-abc123" });
    mockSyncWorkspaceSeats.mockResolvedValue(undefined);

    const result = await createAgent(
      "workspace-1",
      "Release Bot",
      "admin-user-1",
    );

    expect(userValues).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Release Bot",
        isAgent: true,
        emailVerified: false,
        email: null,
      }),
    );
    expect(memberValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        userId: INSERTED_USER.id,
        role: "member",
      }),
    );
    expect(mockCreateApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          userId: INSERTED_USER.id,
          expiresIn: AGENT_API_KEY_EXPIRES_IN_SECONDS,
        }),
      }),
    );
    expect(mockSyncWorkspaceSeats).toHaveBeenCalledWith("workspace-1");
    expect(result).toEqual({
      user: {
        id: INSERTED_USER.id,
        name: INSERTED_USER.name,
        email: null,
        role: "member",
        joinedAt: expect.any(Date),
      },
      apiKey: "raw-agent-key-abc123",
    });
  });

  it("deletes the just-created user and throws 502 when minting the key fails", async () => {
    const { tx } = makeTx();
    mockTransaction.mockImplementation(async (cb) => cb(tx));
    mockCreateApiKey.mockRejectedValue(new Error("better-auth unavailable"));
    const deleteWhere = vi.fn(() => Promise.resolve(undefined));
    mockDelete.mockReturnValue({ where: deleteWhere });

    let caught: unknown;
    try {
      await createAgent("workspace-1", "Release Bot");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HTTPException);
    expect((caught as HTTPException).status).toBe(502);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    // A failed provision nets out to zero member-count change -- seat sync
    // is only meaningful once an agent actually exists.
    expect(mockSyncWorkspaceSeats).not.toHaveBeenCalled();
  });
});
