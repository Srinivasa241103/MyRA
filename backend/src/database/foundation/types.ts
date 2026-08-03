import type { QueryResult, QueryResultRow } from "pg";

export type UserId = string | number;
export type JsonObject = Record<string, unknown>;

export interface Queryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export function assertUserId(userId: UserId): void {
  if (String(userId).trim().length === 0) {
    throw new Error("userId is required for every foundation repository operation");
  }
}
