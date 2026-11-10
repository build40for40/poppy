import { safeEqual, splitMessage, WhatsAppError, type Incoming } from "./whatsapp";

/** Twilio's limit for the body of one outgoing message. */
export const TWILIO_MAX_CHARS = 1600;
/** The WhatsApp sandbox sends one message every three seconds, so the pieces of a long reply are spaced out. */
export const TWILIO_SEND_GAP_MS = 3_100;
const MAX_INCOMING_CHARS = 8192;

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** The sender, as Twilio writes it: `whatsapp:+` then the number. */
  from: string;
  /** How long to wait between the pieces of a long reply. */
  gapMs: number;
}

/**
 * Checks Twilio's `X-Twilio-Signature` header: the base64 HMAC SHA-1, keyed with the auth token, of the URL Twilio called
 * followed by every POST parameter's name and value, sorted by name, with nothing between them.
 */
export async function verifyTwilioSignature(url: string, params: [string, string][], header: string | null, authToken: string): Promise<boolean> {
  if (!header || !authToken) return false;
  return safeEqual(await signTwilio(url, params, authToken), header);
}

export async function signTwilio(url: string, params: [string, string][], authToken: string): Promise<string> {
  const sorted = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const data = url + sorted.map(([name, value]) => name + value).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The URLs the signature may have been made over. Twilio signs the address it called, which is the request's own URL once
 * deployed. Behind a tunnel the Worker sees a different host, so `PUBLIC_BASE_URL` (the tunnel address) gives the other
 * candidate. Forwarded-host headers aren't trusted: anyone can send them.
 */
export function signedUrlCandidates(requestUrl: string, publicBaseUrl: string | undefined): string[] {
  const candidates = [requestUrl];
  const base = publicBaseUrl?.trim().replace(/\/+$/, "");
  if (base) {
    const { pathname, search } = new URL(requestUrl);
    const viaBase = `${base}${pathname}${search}`;
    if (viaBase !== requestUrl) candidates.push(viaBase);
  }
  return candidates;
}

const SENDER = /^whatsapp:\+\d{5,20}$/;

/** The sender numbers in `TWILIO_WHATSAPP_FROM`: one, or several separated by commas. Anything not shaped like a sender is left out. */
export function twilioSenders(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((sender) => sender.trim())
    .filter((sender) => SENDER.test(sender));
}

/**
 * Reads one incoming WhatsApp message out of a verified Twilio webhook. Twilio sends one message per request, as form fields.
 * Anything that isn't a WhatsApp message to one of our senders on our account is left out.
 */
export function incomingTwilioMessage(params: URLSearchParams, config: { accountSid?: string; senders: string[] }): Incoming | null {
  const id = params.get("MessageSid") ?? "";
  if (!/^[A-Z]{2}[0-9a-f]{32}$/i.test(id)) return null;
  if (config.accountSid && params.get("AccountSid") !== config.accountSid) return null;
  const sender = params.get("To") ?? "";
  if (!config.senders.includes(sender)) return null;
  const phone = params.get("From")?.match(/^whatsapp:\+(\d{5,20})$/)?.[1];
  if (!phone) return null;

  const base = { id, phone, userId: null, provider: "twilio" as const, sender };
  const hasMedia = Number(params.get("NumMedia") ?? "0") > 0;
  // TODO(product): voice notes. A voice note arrives as NumMedia=1 with MediaContentType0 starting "audio/" and MediaUrl0
  // pointing at the file (fetched with the account's basic auth). Transcribe it here and return it as kind "text".
  if (hasMedia || params.has("Latitude")) return { ...base, kind: "unsupported", text: "" };
  const body = params.get("Body") ?? "";
  if (!body.trim()) return null;
  return { ...base, kind: "text", text: body.slice(0, MAX_INCOMING_CHARS) };
}

/** What Twilio expects back from a messaging webhook: TwiML. An empty response sends nothing; the reply goes through the API. */
export function emptyTwiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

export const twilioMessagesUrl = (accountSid: string) => `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

/** Sends a text reply through Twilio's Messages API, as several messages if it's longer than one can hold. */
export async function sendTwilioText(config: TwilioConfig, toPhone: string, text: string): Promise<void> {
  for (const [index, body] of splitMessage(text, TWILIO_MAX_CHARS).entries()) {
    if (index && config.gapMs) await new Promise((resolve) => setTimeout(resolve, config.gapMs));
    const response = await fetch(twilioMessagesUrl(config.accountSid), {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: config.from, To: `whatsapp:+${toPhone}`, Body: body }).toString(),
    });
    if (response.ok) {
      await response.body?.cancel();
      continue;
    }
    // Only the status and Twilio's numeric code: the message in the error body can quote the recipient.
    const failure = (await response.json().catch(() => null)) as { code?: unknown } | null;
    throw new WhatsAppError(response.status, typeof failure?.code === "number" ? failure.code : null);
  }
}
