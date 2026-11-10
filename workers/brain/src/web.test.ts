import { env, exports } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEB_LIFE_MS, type UserBrain } from "./brain";
import { BASE_PATH } from "./http";
import { WEB_DAILY_MAX, WEB_MAX_CHARS, WEB_MAX_MESSAGES } from "./gate";
import worker from "./index";
import { brainFor, mockClaude, mockGraph, mockTwilio, type GraphMock, type TwilioMock } from "./testing";
import type { Address } from "./whatsapp";

const WEB_URL = `https://build40for40.com${BASE_PATH}/web`;
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

let twilio: TwilioMock;
let graph: GraphMock;
let visitor: string;
beforeEach(() => {
  graph = mockGraph();
  twilio = mockTwilio();
  visitor = crypto.randomUUID();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const asAddress = (id: string): Address => ({ phone: null, userId: id, provider: "web" });

/** The demo chat's address with WEB_CHAT on, the way the deployed Worker runs it. */
async function say(body: unknown, on = true): Promise<Response> {
  const request = new Request(WEB_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return worker.fetch(request as Parameters<typeof worker.fetch>[0], { ...env, WEB_CHAT: on ? "true" : "" }, createExecutionContext());
}

async function inBrain<T>(id: string, run: (brain: UserBrain, state: DurableObjectState) => T | Promise<T>): Promise<T> {
  return runInDurableObject(await brainFor(asAddress(id)), run);
}

describe("the landing page", () => {
  it("is served at /poppy, with and without the trailing slash", async () => {
    for (const path of ["/poppy", "/poppy/"]) {
      const response = await exports.default.fetch(`https://build40for40.com${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(await response.text()).toContain("<title>Poppy");
    }
  });
});

describe("the demo chat", () => {
  it("isn't there unless WEB_CHAT is on", async () => {
    expect((await say({ id: visitor, text: "Hi" }, false)).status).toBe(404);
  });

  it("answers a visitor with Poppy's reply and says how many messages are left, without touching WhatsApp", async () => {
    const claude = mockClaude(text("Hello from Poppy."));
    const response = await say({ id: visitor, text: "  Hi  " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ replies: [{ text: "Hello from Poppy.", picture: null }], left: WEB_MAX_MESSAGES - 1 });
    expect(claude.requests[0].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
    expect(twilio.requests).toEqual([]);
    expect(graph.requests).toEqual([]);
  });

  it("gives every visitor a brain of their own, and keeps one visitor's chat going", async () => {
    const claude = mockClaude(text("One."), text("Two."), text("Stranger."));
    await say({ id: visitor, text: "First" });
    await say({ id: visitor, text: "Second" });
    await say({ id: crypto.randomUUID(), text: "Hello" });
    expect(claude.requests[1].messages).toHaveLength(3);
    expect(claude.requests[2].messages).toHaveLength(1);
  });

  it("refuses a body that isn't JSON, an id that isn't a UUID, and text that's empty or too long", async () => {
    const claude = mockClaude();
    expect((await say("not json")).status).toBe(400);
    expect((await say({ id: "someone", text: "Hi" })).status).toBe(400);
    expect((await say({ id: visitor, text: "   " })).status).toBe(400);
    expect((await say({ id: visitor, text: "x".repeat(WEB_MAX_CHARS + 1) })).status).toBe(400);
    expect((await say({ id: visitor })).status).toBe(400);
    expect(claude.requests).toEqual([]);
  });

  it("stops a visitor at their allowance", async () => {
    const claude = mockClaude(text("Last one."));
    await inBrain(visitor, async (brain) => {
      await brain.webAllowance(WEB_MAX_MESSAGES);
      (brain as unknown as { saveSetting(key: string, value: string): void }).saveSetting("web_count", String(WEB_MAX_MESSAGES - 1));
    });
    expect(await (await say({ id: visitor, text: "Hi" })).json()).toEqual({ replies: [{ text: "Last one.", picture: null }], left: 0 });
    const refused = await say({ id: visitor, text: "One more?" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "visitor_limit" });
    expect(claude.requests).toHaveLength(1);
  });

  it("stops everyone when the day's allowance is used up", async () => {
    const claude = mockClaude();
    const gate = env.WEB_GATE.get(env.WEB_GATE.idFromName("web"));
    await runInDurableObject(gate, (_, state) => state.storage.put("today", { day: new Date().toISOString().slice(0, 10), used: WEB_DAILY_MAX }));
    const refused = await say({ id: visitor, text: "Hi" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "daily_limit" });
    expect(claude.requests).toEqual([]);
    await runInDurableObject(gate, (_, state) => state.storage.deleteAll());
  });

  it("forgets a visitor a day after their first message", async () => {
    mockClaude(text("Hello."), text("Hello again, stranger."));
    await say({ id: visitor, text: "Hi" });
    await inBrain(visitor, (brain) => (brain as unknown as { saveSetting(key: string, value: string): void }).saveSetting("web_first_at", new Date(Date.now() - WEB_LIFE_MS - 1_000).toISOString()));
    const response = await say({ id: visitor, text: "Remember me?" });
    expect(await response.json()).toEqual({ replies: [{ text: "Hello again, stranger.", picture: null }], left: WEB_MAX_MESSAGES - 1 });
    expect(await inBrain(visitor, (brain) => brain.listSessions())).toHaveLength(1);
  });
});
