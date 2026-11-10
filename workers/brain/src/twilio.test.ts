import { env, exports } from "cloudflare:workers";
import { createExecutionContext, runDurableObjectAlarm, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPLIES, type UserBrain } from "./brain";
import { ALICE as FIXED, brainFor, FAKE_SENDER, fakeSid, fakeTwilioParams, fakeTwilioPerson, mockClaude, mockGraph, mockTwilio, OTHER_FAKE_SENDER, postTwilio, sayAs, sayOnTwilio, sentTexts, TWILIO_WEBHOOK_URL, type GraphMock, type TwilioMock } from "./testing";
import worker from "./index";
import { incomingTwilioMessage, sendTwilioText, signedUrlCandidates, signTwilio, TWILIO_MAX_CHARS, twilioPieces, twilioSenders, twimlReply, verifyTwilioSignature } from "./twilio";
import { brainName, WhatsAppError, type Address } from "./whatsapp";

let twilio: TwilioMock;
let graph: GraphMock;
let ANNA: Address;
beforeEach(() => {
  graph = mockGraph();
  twilio = mockTwilio();
  ANNA = fakeTwilioPerson();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const bodies = () => twilio.requests.map((r) => r.Body);

async function inBrain<T>(who: Address, run: (brain: UserBrain, state: DurableObjectState) => T | Promise<T>): Promise<T> {
  return runInDurableObject(await brainFor(who), run);
}

const tables = (state: DurableObjectState) =>
  state.storage.sql
    .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name")
    .toArray()
    .map((r) => r.name);

const unhandled = (state: DurableObjectState) => (tables(state).includes("inbox") ? state.storage.sql.exec("SELECT COUNT(*) AS n FROM inbox WHERE handled_at IS NULL").one().n : 0);

/** Runs the person's alarm until it has nothing left to do right now. */
async function settle(who: Address = ANNA): Promise<void> {
  await runDurableObjectAlarm(await brainFor(who));
  await vi.waitFor(async () => expect(await inBrain(who, (_, state) => unhandled(state))).toBe(0));
}

const config = (gapMs = 0) => ({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: FAKE_SENDER, gapMs });

describe("verifyTwilioSignature", () => {
  it("matches the worked example in Twilio's docs", async () => {
    const params: [string, string][] = [
      ["Digits", "1234"],
      ["To", "+18005551212"],
      ["From", "+12349013030"],
      ["Caller", "+12349013030"],
      ["CallSid", "CA1234567890ABCDE"],
    ];
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    expect(await signTwilio(url, params, "12345")).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    expect(await verifyTwilioSignature(url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", "12345")).toBe(true);
  });

  it("rejects a changed field, another URL, another token, a missing header and an empty token", async () => {
    const params: [string, string][] = [["Body", "Hi"], ["From", `whatsapp:+${FIXED.phone}`]];
    const header = await signTwilio(TWILIO_WEBHOOK_URL, params, "fake-token");
    expect(await verifyTwilioSignature(TWILIO_WEBHOOK_URL, params, header, "fake-token")).toBe(true);
    expect(await verifyTwilioSignature(TWILIO_WEBHOOK_URL, [["Body", "Hi!"], params[1]], header, "fake-token")).toBe(false);
    expect(await verifyTwilioSignature(`${TWILIO_WEBHOOK_URL}/`, params, header, "fake-token")).toBe(false);
    expect(await verifyTwilioSignature(TWILIO_WEBHOOK_URL, params, header, "other-token")).toBe(false);
    expect(await verifyTwilioSignature(TWILIO_WEBHOOK_URL, params, null, "fake-token")).toBe(false);
    expect(await verifyTwilioSignature(TWILIO_WEBHOOK_URL, params, header, "")).toBe(false);
  });

  it("offers the request's own URL, and the public base URL when one is set", () => {
    expect(signedUrlCandidates("https://build40for40.com/poppy/api/twilio", undefined)).toEqual(["https://build40for40.com/poppy/api/twilio"]);
    expect(signedUrlCandidates("http://localhost:8787/poppy/api/twilio?x=1", "https://fake-tunnel.example.com/ ")).toEqual([
      "http://localhost:8787/poppy/api/twilio?x=1",
      "https://fake-tunnel.example.com/poppy/api/twilio?x=1",
    ]);
    expect(signedUrlCandidates("https://build40for40.com/poppy/api/twilio", "https://build40for40.com")).toEqual(["https://build40for40.com/poppy/api/twilio"]);
  });
});

describe("incomingTwilioMessage", () => {
  const ours = () => ({ accountSid: env.TWILIO_ACCOUNT_SID, senders: twilioSenders(env.TWILIO_WHATSAPP_FROM) });
  const parse = (extra: Record<string, string>, body = "Hello") => incomingTwilioMessage(new URLSearchParams(fakeTwilioParams(ANNA, body, extra)), ours());

  it("reads a text message with its sender's number", () => {
    const sid = fakeSid();
    expect(parse({ MessageSid: sid })).toEqual({ id: sid, phone: ANNA.phone, userId: null, provider: "twilio", sender: FAKE_SENDER, kind: "text", text: "Hello" });
  });

  it("takes a message to any of our sender numbers and keeps which one it was", () => {
    expect(parse({ To: OTHER_FAKE_SENDER })?.sender).toBe(OTHER_FAKE_SENDER);
  });

  it("marks media and locations as unsupported", () => {
    expect(parse({ NumMedia: "1", MediaContentType0: "audio/ogg", MediaUrl0: "https://api.twilio.com/fake-media" }, "")?.kind).toBe("unsupported");
    expect(parse({ Latitude: "51.5", Longitude: "-0.1" }, "")?.kind).toBe("unsupported");
  });

  it("ignores another account, another sender number, a non-WhatsApp sender, a bad id and an empty body", () => {
    expect(parse({ AccountSid: "ACfake00000000000000000000000000002" })).toBeNull();
    expect(parse({ To: `${FAKE_SENDER}0` })).toBeNull();
    expect(parse({ From: `+${FIXED.phone}` })).toBeNull();
    expect(parse({ MessageSid: "not-a-sid" })).toBeNull();
    expect(parse({}, "   ")).toBeNull();
  });
});

describe("sendTwilioText", () => {
  it("posts the sender, the recipient and the body as form fields with basic auth", async () => {
    await sendTwilioText(config(), FIXED.phone!, "Hello");
    expect(twilio.requests).toEqual([{ From: FAKE_SENDER, To: `whatsapp:+${FIXED.phone}`, Body: "Hello" }]);
  });

  it("splits a reply that's longer than one message can hold", async () => {
    const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    expect(long.length).toBeGreaterThan(TWILIO_MAX_CHARS * 2);
    await sendTwilioText(config(), FIXED.phone!, long);
    expect(twilio.requests.length).toBeGreaterThanOrEqual(3);
    expect(twilio.requests.every((r) => r.Body.length <= TWILIO_MAX_CHARS)).toBe(true);
    expect(bodies().join(" ")).toBe(long);
  });

  it("puts a picture on top, with a short reply as its caption", async () => {
    await sendTwilioText(config(), FIXED.phone!, "Try dino bath time.", "https://example.com/p/toy-bath.png");
    expect(twilio.requests).toEqual([{ From: FAKE_SENDER, To: `whatsapp:+${FIXED.phone}`, Body: "Try dino bath time.", MediaUrl: "https://example.com/p/toy-bath.png" }]);
  });

  it("sends the picture on its own, then the text, when the reply is too long for a caption", async () => {
    const long = "word ".repeat(300).trim();
    await sendTwilioText(config(), FIXED.phone!, long, "https://example.com/p/toy-bath.png");
    expect(twilio.requests[0]).toEqual({ From: FAKE_SENDER, To: `whatsapp:+${FIXED.phone}`, MediaUrl: "https://example.com/p/toy-bath.png" });
    expect(twilio.requests.slice(1).map((r) => r.Body).join(" ")).toBe(long);
  });

  it("reports the status and Twilio's code when a send fails, and nothing else", async () => {
    twilio.status = 400;
    const failure = await sendTwilioText(config(), FIXED.phone!, "Hello").catch((e) => e);
    expect(failure).toBeInstanceOf(WhatsAppError);
    expect([failure.status, failure.code]).toEqual([400, 63015]);
    expect(failure.message).not.toContain(FIXED.phone);
  });
});

describe("the Twilio webhook", () => {
  it("only takes a POST", async () => {
    const response = await exports.default.fetch(TWILIO_WEBHOOK_URL);
    expect(response.status).toBe(405);
  });

  it("takes a correctly signed message, answers with empty TwiML and sends exactly one reply through Twilio", async () => {
    const claude = mockClaude(text("Hello back."));
    const response = await sayOnTwilio(ANNA, "Hi");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/xml");
    expect(await response.text()).toContain("<Response></Response>");
    await settle();

    expect(twilio.requests).toEqual([{ From: FAKE_SENDER, To: `whatsapp:+${ANNA.phone}`, Body: "Hello back." }]);
    expect(graph.requests).toEqual([]);
    expect(claude.requests).toHaveLength(1);
    expect(claude.requests[0].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
  });

  it("takes a signature made over the public base URL, for when it runs behind a tunnel", async () => {
    mockClaude(text("Hello."));
    const response = await postTwilio(fakeTwilioParams(ANNA, "Hi"), { signedUrl: `${env.PUBLIC_BASE_URL}/poppy/api/twilio` });
    expect(response.status).toBe(200);
  });

  it("refuses a bad or missing signature, or one made over another address, before using the message", async () => {
    const claude = mockClaude();
    const params = fakeTwilioParams(ANNA, "Should never be read");
    for (const options of [{ signature: null }, { signature: "bm9uc2Vuc2U=" }, { signedUrl: "https://elsewhere.example.com/poppy/api/twilio" }]) {
      const response = await postTwilio(params, options);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "bad_signature" });
    }
    expect(await inBrain(ANNA, (_, state) => tables(state))).toEqual([]);
    expect(claude.requests).toEqual([]);
    expect(twilio.requests).toEqual([]);
  });

  it("drops a repeat delivery of the same message", async () => {
    const claude = mockClaude(text("Hello."));
    const params = fakeTwilioParams(ANNA, "Hi");
    expect((await postTwilio(params)).status).toBe(200);
    expect((await postTwilio(params)).status).toBe(200);
    await settle();
    expect(claude.requests).toHaveLength(1);
    expect(bodies()).toEqual(["Hello."]);
  });

  it("asks for text when it's sent a voice note", async () => {
    const claude = mockClaude();
    await sayOnTwilio(ANNA, "", { NumMedia: "1", MediaContentType0: "audio/ogg", MediaUrl0: "https://api.twilio.com/fake-media" });
    await settle();
    expect(bodies()).toEqual([REPLIES.textOnly]);
    expect(claude.requests).toEqual([]);
  });

  it("ignores a message for another account without waking a brain", async () => {
    await sayOnTwilio(ANNA, "Hi", { AccountSid: "ACfake00000000000000000000000000002" });
    expect(await inBrain(ANNA, (_, state) => tables(state))).toEqual([]);
  });
});

describe("a person on Twilio", () => {
  it("keeps getting replies through Twilio, in the same session", async () => {
    const claude = mockClaude(text("One."), text("Two."));
    await sayOnTwilio(ANNA, "First");
    await settle();
    await sayOnTwilio(ANNA, "Second");
    await settle();
    expect(bodies()).toEqual(["One.", "Two."]);
    expect(graph.requests).toEqual([]);
    expect(claude.requests[1].messages).toHaveLength(3);
    await inBrain(ANNA, (brain, state) => {
      expect(brain.listSessions()).toHaveLength(1);
      expect(state.storage.sql.exec("SELECT value FROM settings WHERE key = 'provider'").one().value).toBe("twilio");
    });
  });

  it("is answered from the sender number they wrote to", async () => {
    mockClaude(text("One."), text("Two."));
    await sayOnTwilio(ANNA, "First", { To: OTHER_FAKE_SENDER });
    await settle();
    await sayOnTwilio(ANNA, "Second");
    await settle();
    expect(twilio.requests.map((r) => r.From)).toEqual([OTHER_FAKE_SENDER, FAKE_SENDER]);
  });

  it("has a different brain from the same number on Meta, and each is answered its own way", async () => {
    const onMeta: Address = { phone: ANNA.phone, userId: null };
    expect(await brainName(ANNA)).not.toBe(await brainName(onMeta));

    mockClaude(text("Hello from Twilio."), text("Hello from Meta."));
    await sayOnTwilio(ANNA, "Hi");
    await settle(ANNA);
    await sayAs(onMeta, "Hi");
    await settle(onMeta);

    expect(bodies()).toEqual(["Hello from Twilio."]);
    expect(sentTexts(graph).map((r) => [r.to, r.text.body])).toEqual([[ANNA.phone, "Hello from Meta."]]);
  });

  it("gets their own text back in echo mode, without calling Claude", async () => {
    const claude = mockClaude();
    await inBrain(ANNA, (brain) => {
      const withEnv = brain as unknown as { env: Env };
      withEnv.env = { ...withEnv.env, ECHO_MODE: "true" };
    });
    await sayOnTwilio(ANNA, "Is this thing on?");
    await settle();
    expect(bodies()).toEqual(["Is this thing on?"]);
    expect(claude.requests).toEqual([]);
  });

  it("is forgotten with /forget, told so through Twilio, and met as a stranger afterwards", async () => {
    const claude = mockClaude(text("Hello."), text("Hello, stranger."));
    await sayOnTwilio(ANNA, "I work nights");
    await settle();
    await sayOnTwilio(ANNA, "/forget");
    await settle();
    expect(bodies()).toEqual(["Hello.", REPLIES.forgotten]);
    await inBrain(ANNA, async (_, state) => {
      expect(tables(state)).toEqual([]);
      expect(await state.storage.getAlarm()).toBeNull();
    });

    await sayOnTwilio(ANNA, "Hi");
    await settle();
    expect(bodies().at(-1)).toBe("Hello, stranger.");
    expect(claude.requests[1].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
  });

  it("still saves the turn when Twilio won't take the reply", async () => {
    mockClaude(text("Hello."));
    twilio.status = 400;
    await sayOnTwilio(ANNA, "Hi");
    await settle();
    expect(await inBrain(ANNA, (brain) => brain.listSessions()[0].user_turns)).toBe(1);
  });
});

describe("twimlReply", () => {
  it("is an empty response when there's nothing to say", async () => {
    expect(await twimlReply([]).text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it("carries each piece as a message, with the picture beside its caption, and escapes what XML would trip on", async () => {
    const xml = await twimlReply([{ Body: 'Tom & Jerry <3 "quotes"', MediaUrl: "https://example.com/pictures/toy-bath.png?a=1&b=2" }, { Body: "Second" }, { MediaUrl: "https://example.com/p.png" }]).text();
    expect(xml).toContain("<Message><Body>Tom &amp; Jerry &lt;3 &quot;quotes&quot;</Body><Media>https://example.com/pictures/toy-bath.png?a=1&amp;b=2</Media></Message>");
    expect(xml).toContain("<Message><Body>Second</Body></Message><Message><Media>https://example.com/p.png</Media></Message>");
  });

  it("lays a reply out the same way a send through the API would", () => {
    expect(twilioPieces("Short", "https://example.com/p.png")).toEqual([{ Body: "Short", MediaUrl: "https://example.com/p.png" }]);
    expect(twilioPieces("x".repeat(TWILIO_MAX_CHARS + 1))).toHaveLength(2);
  });
});

describe("replying inside the webhook's answer", () => {
  /** The Twilio webhook with TWILIO_REPLY_INLINE on, the way the deployed Worker runs it. */
  async function sayInline(from: Address, body: string, extra: Record<string, string> = {}): Promise<Response> {
    const params = fakeTwilioParams(from, body, extra);
    const request = new Request(TWILIO_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": await signTwilio(TWILIO_WEBHOOK_URL, Object.entries(params), env.TWILIO_AUTH_TOKEN) },
      body: new URLSearchParams(params).toString(),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], { ...env, TWILIO_REPLY_INLINE: "true" }, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  }

  it("hands the reply back as TwiML and doesn't call Twilio's API", async () => {
    const claude = mockClaude(text("Hello <back> & welcome."));
    const response = await sayInline(ANNA, "Hi");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/xml");
    expect(await response.text()).toContain("<Response><Message><Body>Hello &lt;back&gt; &amp; welcome.</Body></Message></Response>");
    await settle();

    expect(twilio.requests).toEqual([]);
    expect(claude.requests).toHaveLength(1);
    expect(await inBrain(ANNA, (brain) => brain.listSessions()[0].turns.map((t) => t.text))).toEqual(["Hi", "Hello <back> & welcome."]);
  });

  it("keeps the conversation going across messages, each answered in its own webhook", async () => {
    const claude = mockClaude(text("One."), text("Two."));
    expect(await (await sayInline(ANNA, "First")).text()).toContain("<Body>One.</Body>");
    expect(await (await sayInline(ANNA, "Second")).text()).toContain("<Body>Two.</Body>");
    expect(twilio.requests).toEqual([]);
    expect(claude.requests[1].messages).toHaveLength(3);
  });

  it("answers a repeat delivery with nothing", async () => {
    mockClaude(text("Once."));
    const sid = fakeSid();
    expect(await (await sayInline(ANNA, "Hi", { MessageSid: sid })).text()).toContain("<Body>Once.</Body>");
    expect(await (await sayInline(ANNA, "Hi", { MessageSid: sid })).text()).toContain("<Response></Response>");
  });

  it("says /forget worked in the answer, and leaves nothing behind", async () => {
    mockClaude(text("Hello."));
    await sayInline(ANNA, "Hi");
    await settle();
    const response = await sayInline(ANNA, "/forget");
    expect(await response.text()).toContain(`<Body>${REPLIES.forgotten.replace("'", "&apos;")}</Body>`);
    expect(twilio.requests).toEqual([]);
    expect(await inBrain(ANNA, (_, state) => tables(state))).toEqual([]);
  });

  it("still sends through the API when the setting is off", async () => {
    mockClaude(text("Through the API."));
    const response = await sayOnTwilio(ANNA, "Hi");
    expect(await response.text()).toContain("<Response></Response>");
    await settle();
    expect(bodies()).toEqual(["Through the API."]);
  });
});
