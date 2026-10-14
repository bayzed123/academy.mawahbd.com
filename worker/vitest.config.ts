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
            SSLCOMMERZ_STORE_ID: "test-store",
            SSLCOMMERZ_STORE_PASSWORD: "test-store-password",
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
