import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import deleteAgent from "../../../apps/api/src/agent/controllers/delete-agent";

const MEMBERSHIP = {
  id: "agent-1",
  name: "Release Bot",
  email: "agent-1@agents.invalid",
};

function makeSelectMock(rows: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeTx() {
  const apikeyWhere = vi.fn(() => Promise.resolve(undefined));
  const memberWhere = vi.fn(() => Promise.resolve(undefined));
  let callCount = 0;
  const tx = {
    delete: vi.fn(() => {
      callCount += 1;
      return { where: callCount === 1 ? apikeyWhere : memberWhere };
    }),
  };
  return { tx, apikeyWhere, memberWhere };
}

describe("deleteAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws 404 when the id has no agent membership in this workspace", async () => {
    mockSelect.mockReturnValue(makeSelectMock([]));

    let caught: unknown;
    try {
      await deleteAgent("not-an-agent", "workspace-1");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HTTPException);
    expect((caught as HTTPException).status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("deletes the agent's api keys and workspace membership, and returns it", async () => {
    mockSelect.mockReturnValue(makeSelectMock([MEMBERSHIP]));
    const { tx, apikeyWhere, memberWhere } = makeTx();
    mockTransaction.mockImplementation(async (cb) => cb(tx));

    const result = await deleteAgent("agent-1", "workspace-1");

    expect(result).toEqual(MEMBERSHIP);
    expect(apikeyWhere).toHaveBeenCalledTimes(1);
    expect(memberWhere).toHaveBeenCalledTimes(1);
  });
});
