import { z } from "zod";

const ServerEnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  SERVICE_NAME: z.string().default("jobs"),

  RABBITMQ_URI: z.string().default("amqp://guest:guest@localhost:5672"),
  RABBITMQ_SEARCH_URI: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB_INDEX: z.coerce.number().default(0),
  REDIS_TLS: z
    .union([z.boolean(), z.string()])
    .default(false)
    .transform((v) => v === true || v === "true"),

  CLICKHOUSE_URL: z.string().default("http://localhost:8123/default"),

  QUEUE_DEFAULT_PREFETCH_COUNT: z.coerce.number().default(250),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | undefined;

export function loadServerEnv(): ServerEnv {
  if (!cached) {
    cached = ServerEnvSchema.parse(process.env);
  }
  return cached;
}
