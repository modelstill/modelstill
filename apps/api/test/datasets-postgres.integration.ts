import { afterAll, beforeAll, describe } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema.ts";
import type { CaseDatasetStore } from "../src/datasets.ts";
import { createPostgresDatasets } from "../src/datasets-postgres.ts";
import { removeTask } from "../src/demo.ts";
import { datasetStoreContract } from "./datasets-contract.ts";

const url = process.env["DATABASE_URL"];

describe.skipIf(!url)("postgres case datasets", () => {
  const run = crypto.randomUUID().slice(0, 8);
  const slugs = { slug: `ds-${run}`, other: `ds-other-${run}` };
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let store: CaseDatasetStore;

  beforeAll(async () => {
    client = postgres(url!, { max: 2, onnotice: () => {} });
    db = drizzle(client, { schema });
    await db.insert(schema.tasks).values([
      { slug: slugs.slug, owner: "test" },
      { slug: slugs.other, owner: "test" },
    ]);
    store = createPostgresDatasets(db);
  });

  afterAll(async () => {
    await removeTask(db, slugs.slug);
    await removeTask(db, slugs.other);
    await client.end();
  });

  datasetStoreContract(
    () => slugs,
    () => store,
  );
});
