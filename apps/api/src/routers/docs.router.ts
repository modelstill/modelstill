import { apiReference } from "@scalar/hono-api-reference";
import { Hono } from "hono";

export const docsRouter = new Hono().get(
  "/reference",
  apiReference({
    theme: "kepler",
    url: "/openapi.json",
  }),
);
