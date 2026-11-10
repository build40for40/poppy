import { env, exports } from "cloudflare:workers";
import { vi } from "vitest";
import { BASE_PATH } from "./http";
import { signTwilio, twilioMessagesUrl } from "./twilio";
import { brainName, sign, type Address } from "./whatsapp";

export type ClaudeBlock = { type: "text"; text: string } | { type: "tool_use"; id?: string; name: string; input: unknown };

/** One scripted Messages API response: a streamed reply (held back until `after` settles, if given), an HTTP error, or a stream that breaks partway. */
export type ClaudeReply =
  | { content: ClaudeBlock[]; stop_reason?: "end_turn" | "tool_use" | "max_tokens" | "refusal"; after?: Promise<unknown> }
  | { status: number; message: string }
  | { breakAfter: ClaudeBlock[] };

export interface ClaudeMock {
  /** The JSON bodies sent to the Messages API, in order. */
  requests: Record<string, any>[];
  replies: ClaudeReply[];
}

export interface GraphMock {
  /** The JSON bodies sent to the WhatsApp messages endpoint, in order. */
  requests: Record<string, any>[];
  /** The status to answer with. Anything but 200 comes with a Meta-style error body. */
  status: number;
}

export interface TwilioMock {
  /** The form fields sent to Twilio's Messages endpoint, in order. */
  requests: Record<string, string>[];
  /** The status to answer with. Anything but 201 comes with a Twilio-style error body. */
  status: number;
}

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
let claudeMock: ClaudeMock | null = null;
let graphMock: GraphMock | null = null;
let twilioMock: TwilioMock | null = null;
let toolUseCount = 0;

function installFetchMock(): void {
  if (vi.isMockFunction(globalThis.fetch)) return;
  claudeMock = null;
  graphMock = null;
  twilioMock = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith(ANTHROPIC_MESSAGES_URL) && claudeMock) return claudeResponse(claudeMock, request);
    if (request.url === graphUrl() && graphMock) return graphResponse(graphMock, request);
    if (request.url === twilioMessagesUrl(env.TWILIO_ACCOUNT_SID) && twilioMock) return twilioResponse(twilioMock, request);
    throw new Error(`Unexpected fetch: ${request.method} ${request.url}`);
  });
}

/** Stands in for the Claude Messages API, answering each request with the next scripted reply as a stream. */
export function mockClaude(...replies: ClaudeReply[]): ClaudeMock {
  installFetchMock();
  claudeMock = { requests: [], replies };
  return claudeMock;
}

/** Stands in for the WhatsApp Cloud API's messages endpoint and records what was sent. Any other outbound request fails the test. */
export function mockGraph(): GraphMock {
  installFetchMock();
  graphMock = { requests: [], status: 200 };
  return graphMock;
}

/** Stands in for Twilio's Messages endpoint and records what was sent. */
export function mockTwilio(): TwilioMock {
  installFetchMock();
  twilioMock = { requests: [], status: 201 };
  return twilioMock;
}

async function twilioResponse(mock: TwilioMock, request: Request): Promise<Response> {
  if (request.headers.get("Authorization") !== `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`) return Response.json({ code: 20003, message: "Authenticate" }, { status: 401 });
  mock.requests.push(Object.fromEntries(new URLSearchParams(await request.text())));
  if (mock.status !== 201) return Response.json({ code: 63015, message: "fake failure" }, { status: mock.status });
  return Response.json({ sid: "SMfake", status: "queued" }, { status: 201 });
}

export const graphUrl = () => `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

/** The text messages sent to people, leaving out read receipts and typing indicators. */
export const sentTexts = (graph: GraphMock) => graph.requests.filter((r) => r.type === "text");

async function graphResponse(mock: GraphMock, request: Request): Promise<Response> {
  if (request.headers.get("Authorization") !== `Bearer ${env.WHATSAPP_TOKEN}`) return Response.json({ error: { code: 190, message: "bad token" } }, { status: 401 });
  mock.requests.push(await request.json());
  if (mock.status !== 200) return Response.json({ error: { code: 131000, message: "fake failure" } }, { status: mock.status });
  return Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.fake-outgoing" }] });
}

async function claudeResponse(mock: ClaudeMock, request: Request): Promise<Response> {
  const key = request.headers.get("x-api-key") ?? request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (key !== env.ANTHROPIC_API_KEY) return Response.json(apiError("authentication_error", "bad key"), { status: 401 });
  mock.requests.push(await request.json());
  const reply = mock.replies.shift();
  if (!reply) return Response.json(apiError("invalid_request_error", "No scripted reply left"), { status: 400 });
  if ("status" in reply) return Response.json(apiError("api_error", reply.message), { status: reply.status });
  if ("after" in reply) await reply.after;

  const blocks = "breakAfter" in reply ? reply.breakAfter : reply.content;
  const events: [string, unknown][] = [
    ["message_start", { type: "message_start", message: { id: "msg_fake", type: "message", role: "assistant", model: "claude-fake", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }],
  ];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      const middle = Math.ceil(block.text.length / 2);
      for (const text of [block.text.slice(0, middle), block.text.slice(middle)]) {
        if (text) events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text } }]);
      }
    } else {
      const id = block.id ?? `toolu_fake_${++toolUseCount}`;
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id, name: block.name, input: {} } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  if ("breakAfter" in reply) {
    events.push(["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]);
  } else {
    const stop_reason = reply.stop_reason ?? (blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn");
    events.push(["message_delta", { type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 20 } }]);
    events.push(["message_stop", { type: "message_stop" }]);
  }
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function apiError(type: string, message: string) {
  return { type: "error", error: { type, message } };
}

/** A raw reflection as Opus might return it, untidy on purpose. */
export const fakeReflection = {
  summary: "  Asked about   fake things. Ended happy. ",
  preferences: ["Prefers short answers", "Prefers short answers", " "],
};

/** Fake numbers from Ofcom's range reserved for TV and radio drama. Nobody owns them. */
export const ALICE: Address = { phone: "447700900001", userId: "GB.FAKE0000000000000001" };
export const BOB: Address = { phone: "447700900002", userId: "GB.FAKE0000000000000002" };

let personCount = 0;

/** A new fake person with their own Durable Object. Storage isn't reset between tests, so each test that touches a brain makes its own people. */
export function fakePerson(): Address {
  const n = ++personCount % 1000;
  return { phone: `447700900${String(n).padStart(3, "0")}`, userId: `GB.FAKE${crypto.randomUUID().replaceAll("-", "").toUpperCase()}` };
}

let messageCount = 0;

export interface FakeMessage {
  from?: Address;
  id?: string;
  /** Text for a text message. Leave it out and set `type` for anything else. */
  body?: string;
  type?: string;
}

/** One incoming message as it sits in a webhook's `messages` array. */
export function fakeMessage({ from = ALICE, id = `wamid.fake-${++messageCount}`, body, type = "text" }: FakeMessage = {}): Record<string, unknown> {
  return {
    ...(from.phone ? { from: from.phone } : {}),
    ...(from.userId ? { from_user_id: from.userId } : {}),
    id,
    timestamp: "1794300000",
    type,
    ...(type === "text" ? { text: { body: body ?? "Hello" } } : { [type]: { id: "fake-media-id" } }),
  };
}

/** A `messages` webhook payload in the Cloud API's shape, carrying incoming messages, delivery statuses or both. */
export function fakeWebhook({ messages = [], statuses = [], phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID }: { messages?: unknown[]; statuses?: unknown[]; phoneNumberId?: string } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000002",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "447700900999", phone_number_id: phoneNumberId },
              ...(messages.length ? { contacts: [{ profile: { name: "Fake Person" }, wa_id: ALICE.phone, user_id: ALICE.userId }], messages } : {}),
              ...(statuses.length ? { statuses } : {}),
            },
          },
        ],
      },
    ],
  };
}

/** POSTs a payload to the webhook the way Meta does, signed with the app secret unless told otherwise. */
export async function postWebhook(payload: unknown, { signature }: { signature?: string | null } = {}): Promise<Response> {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const header = signature === undefined ? await sign(raw, env.WHATSAPP_APP_SECRET) : signature;
  return exports.default.fetch(`https://build40for40.com${BASE_PATH}/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(header === null ? {} : { "X-Hub-Signature-256": header }) },
    body: raw,
  });
}

/** Sends one text message from a fake person through the webhook. */
export const sayAs = (from: Address, body: string, id?: string) => postWebhook(fakeWebhook({ messages: [fakeMessage({ from, body, id })] }));

export const brainFor = async (address: Address) => env.USER_BRAIN.get(env.USER_BRAIN.idFromName(await brainName(address)));

// Twilio

let twilioMessageCount = 0;

/** A fake Twilio message id: two letters and 32 hex digits. */
export const fakeSid = () => `SM${String(++twilioMessageCount).padStart(32, "0")}`;

/** A new fake person who arrives through Twilio, with their own Durable Object. */
export function fakeTwilioPerson(): Address {
  return { phone: fakePerson().phone, userId: null, provider: "twilio" };
}

/** The form fields of one incoming WhatsApp message as Twilio posts them. Extra fields override or add to the defaults. */
export function fakeTwilioParams(from: Address, body: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    SmsMessageSid: "SMfake",
    NumMedia: "0",
    ProfileName: "Fake Person",
    MessageType: "text",
    SmsSid: "SMfake",
    WaId: from.phone!,
    SmsStatus: "received",
    Body: body,
    To: env.TWILIO_WHATSAPP_FROM,
    NumSegments: "1",
    ReferralNumMedia: "0",
    MessageSid: fakeSid(),
    AccountSid: env.TWILIO_ACCOUNT_SID,
    From: `whatsapp:+${from.phone}`,
    ApiVersion: "2010-04-01",
    ...extra,
  };
}

export const TWILIO_WEBHOOK_URL = `https://build40for40.com${BASE_PATH}/twilio`;

/** POSTs form fields to the Twilio webhook the way Twilio does, signed with the auth token unless told otherwise. */
export async function postTwilio(params: Record<string, string>, { signature, signedUrl = TWILIO_WEBHOOK_URL }: { signature?: string | null; signedUrl?: string } = {}): Promise<Response> {
  const header = signature === undefined ? await signTwilio(signedUrl, Object.entries(params), env.TWILIO_AUTH_TOKEN) : signature;
  return exports.default.fetch(TWILIO_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(header === null ? {} : { "X-Twilio-Signature": header }) },
    body: new URLSearchParams(params).toString(),
  });
}

/** Sends one text message from a fake person through the Twilio webhook. */
export const sayOnTwilio = (from: Address, body: string, extra?: Record<string, string>) => postTwilio(fakeTwilioParams(from, body, extra));
