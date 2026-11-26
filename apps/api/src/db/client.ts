import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Database = PostgresJsDatabase<typeof schema>;

export type Executor = Pick<Database, "select" | "selectDistinctOn" | "insert" | "update" | "delete" | "execute">;

export function connect(url: string, max = 5) {
  const client = postgres(url, { max, onnotice: () => {} });
  return { client, db: drizzle(client, { schema }) };
}
