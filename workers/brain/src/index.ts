import { BASE_PATH, error, HttpError, readText } from "./http";
import { PICTURE_ID, renderPng, starterPicture, type Picture } from "./pictures";
import { shelfOf } from "./shelf";
import { emptyTwiml, incomingTwilioMessage, signedUrlCandidates, verifyTwilioSignature } from "./twilio";
import { brainName, incomingMessages, safeEqual, verifySignature, type Incoming } from "./whatsapp";

import type { UserBrain } from "./brain";

export { UserBrain } from "./brain";
export { PictureShelf } from "./shelf";

/** Meta batches up to 1,000 updates into one POST. */
const MAX_WEBHOOK_BYTES = 3 * 1024 * 1024;
/** Twilio sends one message per request, as a few dozen form fields. */
const MAX_TWILIO_BYTES = 64 * 1024;
const WEBHOOK_PATH = `${BASE_PATH}/whatsapp`;
const TWILIO_PATH = `${BASE_PATH}/twilio`;
const PICTURES_PATH = `${BASE_PATH}/pictures/`;

// The generated stub types recurse too deeply on JSON, so the stub is typed from the class directly.
type Rpc<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };
type Brain = Rpc<Pick<UserBrain, "receive">>;

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname.startsWith(PICTURES_PATH)) {
      if (request.method !== "GET" && request.method !== "HEAD") return error(405, "method_not_allowed", undefined, { Allow: "GET, HEAD" });
      return picture(request, pathname.slice(PICTURES_PATH.length), env);
    }
    if (pathname !== WEBHOOK_PATH && pathname !== TWILIO_PATH) return error(404, "not_found");
    try {
      if (pathname === TWILIO_PATH) {
        if (request.method === "POST") return await twilioWebhook(request, env);
        return error(405, "method_not_allowed", undefined, { Allow: "POST" });
      }
      if (request.method === "GET") return handshake(searchParams, env);
      if (request.method === "POST") return await webhook(request, env);
      return error(405, "method_not_allowed", undefined, { Allow: "GET, POST" });
    } catch (e) {
      if (e instanceof HttpError) return e.toResponse();
      throw e;
    }
  },
} satisfies ExportedHandler<Env>;

/** Meta calls this once when the callback URL is saved in the dashboard, and expects the challenge echoed back. */
function handshake(params: URLSearchParams, env: Env): Response {
  if (!env.WHATSAPP_VERIFY_TOKEN) return error(503, "whatsapp_unavailable");
  const token = params.get("hub.verify_token") ?? "";
  if (params.get("hub.mode") !== "subscribe" || !safeEqual(token, env.WHATSAPP_VERIFY_TOKEN)) return error(403, "verification_failed");
  return new Response(params.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Checks the signature against the raw body before anything parses it, hands each message to its sender's Durable Object and
 * answers 200. Handing over only stores the message and sets the object's alarm, so the answer goes back in milliseconds;
 * the reply to the person is written and sent from the alarm.
 */
async function webhook(request: Request, env: Env): Promise<Response> {
  if (!env.WHATSAPP_APP_SECRET) return error(503, "whatsapp_unavailable");
  const raw = await readText(request, MAX_WEBHOOK_BYTES);
  if (!(await verifySignature(raw, request.headers.get("X-Hub-Signature-256"), env.WHATSAPP_APP_SECRET))) return error(401, "bad_signature");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return error(400, "invalid_json");
  }
  const messages = incomingMessages(payload, env.WHATSAPP_PHONE_NUMBER_ID ?? "");
  await Promise.all(messages.map((message) => deliver(message, env)));
  return new Response(null, { status: 200 });
}

/**
 * The fallback way in: Twilio's WhatsApp sandbox. Same shape as Meta's webhook: check the signature against the raw form body
 * before using any of it, hand the message to its sender's Durable Object, and answer with empty TwiML. The reply is sent
 * from the object's alarm through Twilio's API.
 */
async function twilioWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.TWILIO_AUTH_TOKEN) return error(503, "twilio_unavailable");
  const raw = await readText(request, MAX_TWILIO_BYTES);
  const params = new URLSearchParams(raw);
  const header = request.headers.get("X-Twilio-Signature");
  let verified = false;
  for (const url of signedUrlCandidates(request.url, env.PUBLIC_BASE_URL)) {
    if (await verifyTwilioSignature(url, [...params], header, env.TWILIO_AUTH_TOKEN)) verified = true;
  }
  if (!verified) return error(401, "bad_signature");

  const message = incomingTwilioMessage(params, { accountSid: env.TWILIO_ACCOUNT_SID, from: env.TWILIO_WHATSAPP_FROM });
  if (message) await deliver(message, env);
  return emptyTwiml();
}

/**
 * A picture as a PNG, for Twilio or Meta to fetch and put on a suggestion. It's drawn from the SVG on the first fetch and
 * kept in the edge cache after that. Pictures hold no one's data, so anyone may fetch them.
 */
async function picture(request: Request, file: string, env: Env): Promise<Response> {
  const id = file.match(/^(.+)\.png$/)?.[1] ?? "";
  if (!PICTURE_ID.test(id)) return error(404, "not_found");
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) return request.method === "HEAD" ? new Response(null, cached) : cached;

  const found: Picture | null = starterPicture(id) ?? (await shelfOf(env).get(id));
  if (!found) return error(404, "not_found");
  const png = await renderPng(found);
  const response = new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
  await caches.default.put(cacheKey, response.clone());
  return request.method === "HEAD" ? new Response(null, response) : response;
}

async function deliver(message: Incoming, env: Env): Promise<void> {
  const brain = env.USER_BRAIN.get(env.USER_BRAIN.idFromName(await brainName(message))) as unknown as Brain;
  await brain.receive(message);
}
