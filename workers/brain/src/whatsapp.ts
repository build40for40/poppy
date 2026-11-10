import { isPlainObject } from "./http";

/** WhatsApp's limit for one text message body. */
export const MAX_MESSAGE_CHARS = 4096;
/** WhatsApp's limit for the caption under a picture. A longer reply goes as the picture on its own, then the text. */
export const MAX_CAPTION_CHARS = 1024;
/** Longer incoming text is cut here. WhatsApp itself stops at 4,096, so this only guards against a malformed payload. */
const MAX_INCOMING_CHARS = 8192;
const MAX_ID_CHARS = 256;

/** Message types that get a "text only for now" reply. Everything else that isn't text (reactions, system notices, button taps) is ignored quietly. */
const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker", "location", "contacts"]);

/**
 * Where to reply. Meta sends a business-scoped user id (`from_user_id`) with every message, and leaves the phone number out
 * for people who have a WhatsApp username and haven't shared their number with this business.
 */
export interface Address {
  phone: string | null;
  userId: string | null;
  /** Who carried the message. Left out, it's Meta's Cloud API. */
  provider?: Provider;
  /** Twilio only: which of our numbers the person wrote to, as `whatsapp:+` then the number. Replies go out from it. */
  sender?: string;
}

/** The two ways a WhatsApp message can reach us: Meta's Cloud API, or Twilio's WhatsApp sandbox as the fallback. */
export type Provider = "meta" | "twilio";

export interface Incoming extends Address {
  /** WhatsApp's message id (`wamid...`), used to drop repeat deliveries and to mark the message read. */
  id: string;
  kind: "text" | "unsupported";
  text: string;
}

const GRAPH_API_BASE = "https://graph.facebook.com";

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
  /** Sent to in place of the Graph API, for local runs. */
  apiBase?: string;
}

/**
 * The one id a person is known by: the business-scoped user id when Meta sends one, their number otherwise. Someone who
 * arrives through Twilio gets a prefix, so the same number on the two providers is never mistaken for one brain.
 */
export function identityOf(address: Address): string {
  const id = address.userId ?? address.phone ?? "";
  return address.provider === "twilio" ? `twilio:${id}` : id;
}

/** The name of a person's Durable Object: a hash, so no phone number ends up in an object name or a log line. */
export async function brainName(address: Address): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identityOf(address)));
  return hex(new Uint8Array(digest));
}

/** Compares two strings without leaking where they differ through timing. */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.byteLength !== right.byteLength) return false;
  return crypto.subtle.timingSafeEqual(left, right);
}

/** Checks Meta's `X-Hub-Signature-256` header: `sha256=` then the HMAC SHA-256 of the raw body, keyed with the app secret. */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  const match = header?.match(/^sha256=([0-9a-f]{64})$/i);
  if (!match || !appSecret) return false;
  const signature = new Uint8Array(match[1].match(/../g)!.map((byte) => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(rawBody));
}

export async function sign(rawBody: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))))}`;
}

/**
 * Pulls the messages people sent out of a verified webhook payload. Delivery statuses (sent, delivered, read), other webhook
 * fields and messages for a different business number are left out. One POST can carry several messages.
 */
export function incomingMessages(payload: unknown, phoneNumberId: string): Incoming[] {
  if (!isPlainObject(payload) || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return [];
  const found: Incoming[] = [];
  for (const entry of payload.entry) {
    if (!isPlainObject(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isPlainObject(change) || change.field !== "messages" || !isPlainObject(change.value)) continue;
      const { value } = change;
      if (value.messaging_product !== "whatsapp" || !Array.isArray(value.messages)) continue;
      if (phoneNumberId && (!isPlainObject(value.metadata) || value.metadata.phone_number_id !== phoneNumberId)) continue;
      for (const message of value.messages) {
        const incoming = parseMessage(message);
        if (incoming) found.push(incoming);
      }
    }
  }
  return found;
}

function parseMessage(message: unknown): Incoming | null {
  if (!isPlainObject(message)) return null;
  const { id, type } = message;
  if (typeof id !== "string" || !id || id.length > MAX_ID_CHARS || typeof type !== "string") return null;
  const phone = typeof message.from === "string" && /^\d{5,20}$/.test(message.from) ? message.from : null;
  const userId = typeof message.from_user_id === "string" && /^[A-Za-z0-9._-]{1,256}$/.test(message.from_user_id) ? message.from_user_id : null;
  if (!phone && !userId) return null;
  if (type === "text") {
    const body = isPlainObject(message.text) ? message.text.body : null;
    if (typeof body !== "string" || !body.trim()) return null;
    return { id, phone, userId, kind: "text", text: body.slice(0, MAX_INCOMING_CHARS) };
  }
  return MEDIA_TYPES.has(type) ? { id, phone, userId, kind: "unsupported", text: "" } : null;
}

/** Cuts a reply into pieces WhatsApp will take, breaking at a paragraph, line or word where it can. */
export function splitMessage(text: string, max = MAX_MESSAGE_CHARS): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const at = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")].find((i) => i > max / 2) ?? max;
    pieces.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export class WhatsAppError extends Error {
  constructor(
    readonly status: number,
    /** Meta's numeric error code, when the response had one. Safe to log; the error message isn't, as it can quote the recipient. */
    readonly code: number | null,
  ) {
    super(`WhatsApp answered ${status}${code === null ? "" : ` (code ${code})`}.`);
  }
}

/**
 * Sends a reply through the Cloud API, as several messages if it's longer than one can hold. With a picture URL, the
 * picture goes first, with the reply as its caption when it fits. Meta fetches the picture from the URL itself.
 */
export async function sendText(config: WhatsAppConfig, to: Address, text: string, picture?: string): Promise<void> {
  const recipient = to.phone ? { to: to.phone } : { recipient: to.userId };
  const base = { messaging_product: "whatsapp", recipient_type: "individual", ...recipient };
  if (picture) {
    const captioned = text.length <= MAX_CAPTION_CHARS;
    await post(config, { ...base, type: "image", image: { link: picture, ...(captioned ? { caption: text } : {}) } });
    if (captioned) return;
  }
  for (const body of splitMessage(text)) {
    await post(config, { messaging_product: "whatsapp", recipient_type: "individual", ...recipient, type: "text", text: { preview_url: false, body } });
  }
}

/** Marks a message as read and shows "typing…" until the reply is sent, or for 25 seconds. */
export async function markReadAndTyping(config: WhatsAppConfig, messageId: string): Promise<void> {
  await post(config, { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } });
}

async function post(config: WhatsAppConfig, body: unknown): Promise<void> {
  const base = (config.apiBase?.trim() || GRAPH_API_BASE).replace(/\/+$/, "");
  const response = await fetch(`${base}/${config.apiVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) {
    await response.body?.cancel();
    return;
  }
  const failure = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  throw new WhatsAppError(response.status, typeof failure?.error?.code === "number" ? failure.error.code : null);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
