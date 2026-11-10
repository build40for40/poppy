import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** A fake sandbox sender, from Ofcom's range reserved for TV and radio drama. Nobody owns it. */
const FAKE_SENDER_DIGITS = "447700900998";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // These also override anything in a local .dev.vars, so a developer's ECHO_MODE or real keys never reach a test.
        bindings: {
          ECHO_MODE: "",
          DEV_TOOLS: "",
          WHATSAPP_API_BASE: "",
          IDLE_MINUTES: "",
          NUDGE_AFTER_MINUTES: "",
          ANTHROPIC_API_KEY: "fake-anthropic-api-key",
          WHATSAPP_APP_SECRET: "fake-whatsapp-app-secret",
          WHATSAPP_TOKEN: "fake-whatsapp-token",
          WHATSAPP_VERIFY_TOKEN: "fake-whatsapp-verify-token",
          WHATSAPP_PHONE_NUMBER_ID: "100000000000001",
          TWILIO_ACCOUNT_SID: "ACfake00000000000000000000000000001",
          TWILIO_AUTH_TOKEN: "fake-twilio-auth-token",
          TWILIO_WHATSAPP_FROM: `whatsapp:+${FAKE_SENDER_DIGITS}`,
          PUBLIC_BASE_URL: "https://fake-tunnel.example.com",
        },
      },
    }),
  ],
});
