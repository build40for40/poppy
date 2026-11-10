import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALICE, BOB, fakeMessage, fakeWebhook, mockGraph } from "./testing";
import { brainName, identityOf, incomingMessages, markReadAndTyping, MAX_MESSAGE_CHARS, safeEqual, sendText, sign, splitMessage, verifySignature, WhatsAppError } from "./whatsapp";

afterEach(() => {
  vi.restoreAllMocks();
});

const config = () => ({ token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, apiVersion: env.WHATSAPP_API_VERSION });
const id = env.WHATSAPP_PHONE_NUMBER_ID;

describe("verifySignature", () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}';

  it("accepts the HMAC SHA-256 of the raw body under the app secret", async () => {
    const header = await sign(body, "fake-secret");
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await verifySignature(body, header, "fake-secret")).toBe(true);
    expect(await verifySignature(body, header.toUpperCase().replace("SHA256", "sha256"), "fake-secret")).toBe(true);
  });

  it("matches a known HMAC", async () => {
    // RFC 4231, test case 2.
    expect(await sign("what do ya want for nothing?", "Jefe")).toBe("sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });

  it("rejects a changed body, another secret, a missing or malformed header and an empty secret", async () => {
    const header = await sign(body, "fake-secret");
    expect(await verifySignature(`${body} `, header, "fake-secret")).toBe(false);
    expect(await verifySignature(body, header, "other-secret")).toBe(false);
    expect(await verifySignature(body, null, "fake-secret")).toBe(false);
    expect(await verifySignature(body, header.replace("sha256=", "sha1="), "fake-secret")).toBe(false);
    expect(await verifySignature(body, "sha256=abc", "fake-secret")).toBe(false);
    expect(await verifySignature(body, header, "")).toBe(false);
  });

  it("compares strings safely", () => {
    expect(safeEqual("fake-token", "fake-token")).toBe(true);
    expect(safeEqual("fake-token", "fake-tokem")).toBe(false);
    expect(safeEqual("fake-token", "fake")).toBe(false);
  });
});

describe("incomingMessages", () => {
  it("reads a text message with its sender's number and user id", () => {
    const payload = fakeWebhook({ messages: [fakeMessage({ id: "wamid.one", body: "Hello" })] });
    expect(incomingMessages(payload, id)).toEqual([{ id: "wamid.one", phone: ALICE.phone, userId: ALICE.userId, kind: "text", text: "Hello" }]);
  });

  it("reads a message that only has a user id, or only a number", () => {
    const noPhone = fakeWebhook({ messages: [fakeMessage({ from: { phone: null, userId: BOB.userId }, id: "wamid.two" })] });
    expect(incomingMessages(noPhone, id)).toEqual([{ id: "wamid.two", phone: null, userId: BOB.userId, kind: "text", text: "Hello" }]);
    const noUserId = fakeWebhook({ messages: [fakeMessage({ from: { phone: BOB.phone, userId: null }, id: "wamid.three" })] });
    expect(incomingMessages(noUserId, id)).toEqual([{ id: "wamid.three", phone: BOB.phone, userId: null, kind: "text", text: "Hello" }]);
  });

  it("ignores delivery statuses", () => {
    const payload = fakeWebhook({ statuses: [{ id: "wamid.sent", status: "delivered", timestamp: "1794300000", recipient_id: ALICE.phone }] });
    expect(incomingMessages(payload, id)).toEqual([]);
  });

  it("marks media as unsupported and drops reactions, system notices and anything it can't place", () => {
    const payload = fakeWebhook({
      messages: [
        fakeMessage({ id: "wamid.image", type: "image" }),
        fakeMessage({ id: "wamid.audio", type: "audio" }),
        fakeMessage({ id: "wamid.reaction", type: "reaction" }),
        fakeMessage({ id: "wamid.system", type: "system" }),
        { id: "wamid.nobody", type: "text", text: { body: "Hi" } },
        { from: "not-a-number", id: "wamid.bad-from", type: "text", text: { body: "Hi" } },
        { from: ALICE.phone, type: "text", text: { body: "No id" } },
        { from: ALICE.phone, id: "wamid.empty", type: "text", text: { body: "   " } },
      ],
    });
    expect(incomingMessages(payload, id).map((m) => [m.id, m.kind])).toEqual([
      ["wamid.image", "unsupported"],
      ["wamid.audio", "unsupported"],
    ]);
  });

  it("ignores other webhook fields, other products, other business numbers and junk", () => {
    const message = fakeMessage();
    expect(incomingMessages(fakeWebhook({ messages: [message], phoneNumberId: "999" }), id)).toEqual([]);
    expect(incomingMessages({ object: "page", entry: fakeWebhook({ messages: [message] }).entry }, id)).toEqual([]);
    expect(incomingMessages({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: { messaging_product: "whatsapp", messages: [message] } }] }] }, id)).toEqual([]);
    for (const junk of [null, [], "text", { object: "whatsapp_business_account" }, { object: "whatsapp_business_account", entry: [null, { changes: [null, { field: "messages" }] }] }]) {
      expect(incomingMessages(junk, id)).toEqual([]);
    }
  });
});

describe("identity", () => {
  it("knows a person by their user id when there is one, and their number otherwise", () => {
    expect(identityOf(ALICE)).toBe(ALICE.userId);
    expect(identityOf({ phone: ALICE.phone, userId: null })).toBe(ALICE.phone);
  });

  it("names the Durable Object with a hash, the same every time and different per person", async () => {
    const name = await brainName(ALICE);
    expect(name).toMatch(/^[0-9a-f]{64}$/);
    expect(name).not.toContain(ALICE.phone);
    expect(await brainName({ ...ALICE })).toBe(name);
    expect(await brainName(BOB)).not.toBe(name);
  });
});

describe("splitMessage", () => {
  it("leaves a short message whole and drops an empty one", () => {
    expect(splitMessage("  Hello.  ")).toEqual(["Hello."]);
    expect(splitMessage("   ")).toEqual([]);
  });

  it("breaks a long message at a paragraph, a line or a word, never over the limit", () => {
    const paragraphs = `${"a".repeat(3000)}\n\n${"b".repeat(3000)}`;
    expect(splitMessage(paragraphs)).toEqual(["a".repeat(3000), "b".repeat(3000)]);
    const words = Array.from({ length: 2000 }, () => "word").join(" ");
    const pieces = splitMessage(words);
    expect(pieces.length).toBe(3);
    expect(pieces.every((p) => p.length <= MAX_MESSAGE_CHARS && !p.startsWith(" ") && !p.endsWith(" "))).toBe(true);
    expect(pieces.join(" ")).toBe(words);
    expect(splitMessage("x".repeat(9000)).map((p) => p.length)).toEqual([4096, 4096, 808]);
  });
});

describe("sending", () => {
  it("sends a text message to a number", async () => {
    const graph = mockGraph();
    await sendText(config(), ALICE, "Hello.");
    expect(graph.requests).toEqual([{ messaging_product: "whatsapp", recipient_type: "individual", to: ALICE.phone, type: "text", text: { preview_url: false, body: "Hello." } }]);
  });

  it("sends to the user id when there's no number", async () => {
    const graph = mockGraph();
    await sendText(config(), { phone: null, userId: BOB.userId }, "Hello.");
    expect(graph.requests[0]).toMatchObject({ recipient: BOB.userId });
    expect(graph.requests[0]).not.toHaveProperty("to");
  });

  it("sends a long reply as several messages, in order", async () => {
    const graph = mockGraph();
    await sendText(config(), ALICE, `${"a".repeat(3000)}\n\n${"b".repeat(3000)}`);
    expect(graph.requests.map((r) => r.text.body[0])).toEqual(["a", "b"]);
  });

  it("marks a message read and shows typing", async () => {
    const graph = mockGraph();
    await markReadAndTyping(config(), "wamid.one");
    expect(graph.requests).toEqual([{ messaging_product: "whatsapp", status: "read", message_id: "wamid.one", typing_indicator: { type: "text" } }]);
  });

  it("reports a failure by status and Meta's code only", async () => {
    const graph = mockGraph();
    graph.status = 400;
    const failure = await sendText(config(), ALICE, "Hello.").catch((e) => e);
    expect(failure).toBeInstanceOf(WhatsAppError);
    expect(failure).toMatchObject({ status: 400, code: 131000 });
    expect(failure.message).not.toContain(ALICE.phone);
  });
});
