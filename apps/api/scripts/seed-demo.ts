import { connect } from "../src/db/client.ts";
import { DEMO_SLUG, demoServingEvents, seedDemo } from "../src/demo.ts";

const LOCAL_DATABASE = "postgres://postgres:postgres@localhost:5434/modelstill";

async function clickhouse(url: string, query: string, body?: string, params: Record<string, string> = {}) {
  const target = new URL(url);
  target.searchParams.set("query", query);
  for (const [name, value] of Object.entries(params)) target.searchParams.set(`param_${name}`, value);
  const headers: Record<string, string> = {};
  if (process.env["CLICKHOUSE_USER"]) headers["x-clickhouse-user"] = process.env["CLICKHOUSE_USER"];
  if (process.env["CLICKHOUSE_PASSWORD"]) headers["x-clickhouse-key"] = process.env["CLICKHOUSE_PASSWORD"];
  const response = await fetch(target, { method: "POST", headers, body: body ?? "" });
  if (!response.ok) throw new Error(`ClickHouse: ${await response.text()}`);
}

async function seedServingEvents(url: string, now: Date) {
  const events = demoServingEvents(DEMO_SLUG, now);
  await clickhouse(url, "DELETE FROM modelstill.serving_events WHERE task = {task:String}", undefined, { task: DEMO_SLUG });
  await clickhouse(
    url,
    "INSERT INTO modelstill.serving_events FORMAT JSONEachRow",
    events.map((event) => JSON.stringify(event)).join("\n"),
  );
  return events.length;
}

const now = new Date();
const { client, db } = connect(process.env["DATABASE_URL"] ?? LOCAL_DATABASE, 1);
try {
  await seedDemo(db, { now });
  console.info(`seeded demo task "${DEMO_SLUG}" in Postgres`);
  const clickhouseUrl = process.env["CLICKHOUSE_URL"];
  if (clickhouseUrl) {
    const count = await seedServingEvents(clickhouseUrl, now);
    console.info(`seeded ${count} synthetic serving events in ClickHouse`);
  }
} finally {
  await client.end();
}
