import { BASE_PATH, error, HttpError, readText } from "./http";
import { brainName, incomingMessages, safeEqual, verifySignature, type Incoming } from "./whatsapp";

import type { UserBrain } from "./brain";

export { UserBrain } from "./brain";

/** Meta batches up to 1,000 updates into one POST. */
const MAX_WEBHOOK_BYTES = 3 * 1024 * 1024;
const WEBHOOK_PATH = `${BASE_PATH}/whatsapp`;

// The generated stub types recurse too deeply on JSON, so the stub is typed from the class directly.
type Rpc<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };
type Brain = Rpc<Pick<UserBrain, "receive">>;

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname !== WEBHOOK_PATH) return error(404, "not_found");
    try {
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

async function deliver(message: Incoming, env: Env): Promise<void> {
  const brain = env.USER_BRAIN.get(env.USER_BRAIN.idFromName(await brainName(message))) as unknown as Brain;
  await brain.receive(message);
}
