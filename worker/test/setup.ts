import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Apply schema + catalog seed to the isolated per-file D1 database before any test runs.
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: never[] }).TEST_MIGRATIONS);
