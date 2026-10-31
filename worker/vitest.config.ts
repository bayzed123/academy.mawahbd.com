import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const here = decodeURIComponent(new URL(".", import.meta.url).pathname);

export default defineConfig(async () => {
  const migrations = await readD1Migrations(`${here}migrations`);
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./.wrangler.dev.toml" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // test-only fake secrets — never real keys
            APP_SECRET: "test-app-secret-0123456789abcdef0123456789abcdef",
            SETUP_TOKEN: "test-setup-token",
            ALLOW_MOCK_PAYMENTS: "true",
            ANALYTICS_DEV: "false", // counting visits is switched on by the tests that exercise it, never by a developer's own .dev.vars
            SSLCOMMERZ_STORE_ID: "test-store",
            SSLCOMMERZ_STORE_PASSWORD: "test-store-password",
            // the couriers, stood in for by test/courier.test.ts (nothing ever leaves the machine)
            STEADFAST_API_KEY: "test-steadfast-key",
            STEADFAST_SECRET_KEY: "test-steadfast-secret",
            STEADFAST_WEBHOOK_TOKEN: "test-steadfast-webhook-token",
            PATHAO_CLIENT_ID: "test-pathao-client",
            PATHAO_CLIENT_SECRET: "test-pathao-client-secret",
            PATHAO_WEBHOOK_SECRET: "test-pathao-webhook-secret",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
      testTimeout: 20_000,
      hookTimeout: 30_000,
    },
  };
});
