import { and, eq } from "drizzle-orm";
import db from "../../database";
import { userTable, workspaceUserTable } from "../../database/schema";

async function getAgents(workspaceId: string) {
  return db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      role: workspaceUserTable.role,
      joinedAt: workspaceUserTable.joinedAt,
    })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(workspaceUserTable.userId, userTable.id))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(userTable.isAgent, true),
      ),
    );
}

export default getAgents;
