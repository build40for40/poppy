import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ANTHROPIC_API_KEY: "fake-anthropic-api-key",
          WHATSAPP_APP_SECRET: "fake-whatsapp-app-secret",
          WHATSAPP_TOKEN: "fake-whatsapp-token",
          WHATSAPP_VERIFY_TOKEN: "fake-whatsapp-verify-token",
          WHATSAPP_PHONE_NUMBER_ID: "100000000000001",
        },
      },
    }),
  ],
});
