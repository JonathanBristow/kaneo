import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

import getAgents from "../../../apps/api/src/agent/controllers/get-agents";

function makeSelectMock(rows: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

describe("getAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the agent member rows resolved by the query", async () => {
    const ROWS = [
      {
        id: "agent-1",
        name: "Release Bot",
        email: "agent-1@agents.invalid",
        role: "member",
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    mockSelect.mockReturnValue(makeSelectMock(ROWS));

    const result = await getAgents("workspace-1");

    expect(result).toEqual(ROWS);
  });

  it("returns an empty list when the workspace has no agents", async () => {
    mockSelect.mockReturnValue(makeSelectMock([]));

    const result = await getAgents("workspace-1");

    expect(result).toEqual([]);
  });
});
