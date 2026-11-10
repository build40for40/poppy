// The secrets. wrangler.jsonc has no required list (it says why), so `wrangler types` doesn't know them and this adds them
// to the generated Env. Any of them can be unset when the Worker runs, which reads as undefined: every use checks for that.
interface __BaseEnv_Env {
  ANTHROPIC_API_KEY: string;
  WHATSAPP_APP_SECRET: string;
  WHATSAPP_TOKEN: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_WHATSAPP_FROM: string;
}
