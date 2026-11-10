import { env, exports } from "cloudflare:workers";
import { createExecutionContext, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_MINUTES, REFLECTION_RETRY_MINUTES, REPLIES, TURN_CAP, type UserBrain } from "./brain";
import { BASE_PATH } from "./http";
import worker from "./index";
import { NUDGE_AFTER_MINUTES } from "./plays";
import { LIVE_PROMPT } from "./prompt";
import { SCHEMA_VERSION } from "./schema";
import { brainFor, fakeMessage as rawMessage, fakePerson, fakeReflection, fakeWebhook, mockClaude, mockGraph, postWebhook, sayAs, sentTexts, type FakeMessage, type GraphMock } from "./testing";
import { sign, type Address } from "./whatsapp";

let graph: GraphMock;
let ALICE: Address;
let BOB: Address;
beforeEach(() => {
  graph = mockGraph();
  ALICE = fakePerson();
  BOB = fakePerson();
});

const say = (body: string, from: Address = ALICE, id?: string) => sayAs(from, body, id);
const fakeMessage = (message: FakeMessage = {}) => rawMessage({ from: ALICE, ...message });
afterEach(() => {
  vi.restoreAllMocks();
});

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const reflectionReply = () => text(JSON.stringify(fakeReflection));

/** Runs the person's alarm until it has nothing left to do right now. */
async function settle(who: Address = ALICE): Promise<void> {
  const stub = await brainFor(who);
  await runDurableObjectAlarm(stub);
  await vi.waitFor(async () => expect(await inBrain(who, (_, state) => unhandled(state))).toBe(0));
}

async function inBrain<T>(who: Address, run: (brain: UserBrain, state: DurableObjectState) => T | Promise<T>): Promise<T> {
  return runInDurableObject(await brainFor(who), run);
}

const tables = (state: DurableObjectState) =>
  state.storage.sql
    .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name")
    .toArray()
    .map((r) => r.name);

const unhandled = (state: DurableObjectState) => (tables(state).includes("inbox") ? state.storage.sql.exec("SELECT COUNT(*) AS n FROM inbox WHERE handled_at IS NULL").one().n : 0);

const withEnv = (vars: Partial<Env>, who: Address = ALICE) =>
  inBrain(who, (brain) => {
    const held = brain as unknown as { env: Env };
    held.env = { ...held.env, ...vars };
  });

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe("routes", () => {
  it("only answers at the webhook path", async () => {
    for (const path of ["", "/", "/me", "/whatsapp/extra"]) {
      const response = await exports.default.fetch(`https://build40for40.com${BASE_PATH}${path}`);
      expect(response.status).toBe(404);
    }
    const response = await exports.default.fetch(`https://build40for40.com${BASE_PATH}/whatsapp`, { method: "DELETE" });
    expect(response.status).toBe(405);
  });
});

describe("the verify handshake", () => {
  const handshake = (params: Record<string, string>) => exports.default.fetch(`https://build40for40.com${BASE_PATH}/whatsapp?${new URLSearchParams(params)}`);

  it("echoes the challenge for the right verify token", async () => {
    const response = await handshake({ "hub.mode": "subscribe", "hub.verify_token": env.WHATSAPP_VERIFY_TOKEN, "hub.challenge": "1158201444" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1158201444");
  });

  it("refuses the wrong token, a missing token and the wrong mode", async () => {
    for (const params of [{ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1" }, { "hub.mode": "subscribe", "hub.challenge": "1" }, { "hub.mode": "unsubscribe", "hub.verify_token": env.WHATSAPP_VERIFY_TOKEN, "hub.challenge": "1" }] as Record<string, string>[]) {
      const response = await handshake(params);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("1158201444");
    }
  });
});

describe("the webhook signature", () => {
  const payload = () => fakeWebhook({ messages: [fakeMessage({ from: BOB, body: "Should never be read" })] });

  it("takes a correctly signed payload", async () => {
    mockClaude(text("Hello."));
    const response = await postWebhook(fakeWebhook({ messages: [fakeMessage({ body: "Hi" })] }));
    expect(response.status).toBe(200);
    await settle();
    expect(sentTexts(graph)).toHaveLength(1);
  });

  it("refuses a bad or missing signature before reading the body", async () => {
    const claude = mockClaude();
    for (const signature of [null, "sha256=" + "0".repeat(64), "nonsense"]) {
      const response = await postWebhook(payload(), { signature });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "bad_signature" });
    }
    expect(await inBrain(BOB, (_, state) => tables(state))).toEqual([]);
    expect(claude.requests).toEqual([]);
    expect(graph.requests).toEqual([]);
  });

  it("refuses unsigned junk without trying to parse it, and signed junk as bad JSON", async () => {
    expect((await postWebhook("not json", { signature: null })).status).toBe(401);
    expect((await postWebhook("not json")).status).toBe(400);
  });
});

describe("incoming webhooks", () => {
  it("ignores delivery statuses", async () => {
    const claude = mockClaude();
    const response = await postWebhook(fakeWebhook({ statuses: [{ id: "wamid.sent", status: "read", timestamp: "1794300000", recipient_id: ALICE.phone }] }));
    expect(response.status).toBe(200);
    expect(await inBrain(ALICE, (_, state) => tables(state))).toEqual([]);
    expect(claude.requests).toEqual([]);
    expect(graph.requests).toEqual([]);
  });

  it("drops a repeat delivery of the same message", async () => {
    const claude = mockClaude(text("Hello."));
    await say("Hi", ALICE, "wamid.repeat");
    await settle();
    expect((await say("Hi", ALICE, "wamid.repeat")).status).toBe(200);
    await settle();
    expect(claude.requests).toHaveLength(1);
    expect(sentTexts(graph)).toHaveLength(1);
  });

  it("asks for text when it's sent something it can't read", async () => {
    const claude = mockClaude();
    await postWebhook(fakeWebhook({ messages: [fakeMessage({ type: "audio" })] }));
    await settle();
    expect(sentTexts(graph).map((r) => r.text.body)).toEqual([REPLIES.textOnly]);
    expect(claude.requests).toEqual([]);
  });

  it("keeps each person in their own Durable Object", async () => {
    mockClaude(text("Hello Alice."), text("Hello Bob."));
    await say("I'm Alice", ALICE);
    await settle(ALICE);
    await say("I'm Bob", BOB);
    await settle(BOB);
    expect(sentTexts(graph).map((r) => [r.to, r.text.body])).toEqual([
      [ALICE.phone, "Hello Alice."],
      [BOB.phone, "Hello Bob."],
    ]);
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[0].turns[0]).toMatchObject({ text: "I'm Alice" });
    expect((await inBrain(BOB, (brain) => brain.listSessions()))[0].turns[0]).toMatchObject({ text: "I'm Bob" });
  });
});

describe("a turn", () => {
  it("creates the schema and a starter USER.md on the first message", async () => {
    mockClaude(text("Hello."));
    await say("Hi");
    await settle();
    await inBrain(ALICE, (brain, state) => {
      expect(tables(state)).toEqual(["files", "inbox", "links", "schema_migrations", "sessions", "settings"]);
      expect(state.storage.sql.exec("SELECT MAX(version) AS v FROM schema_migrations").one().v).toBe(SCHEMA_VERSION);
      expect(state.storage.sql.exec("SELECT path, kind FROM files").toArray()).toEqual([{ path: "USER.md", kind: "user" }]);
      expect(brain.getProfile()).toMatchObject({ preferences: {}, learned: [] });
    });
  });

  it("marks the message read, shows typing, then sends exactly one reply", async () => {
    const claude = mockClaude(text("Hello back."));
    await say("Hello", ALICE, "wamid.hello");
    await settle();
    expect(graph.requests).toEqual([
      { messaging_product: "whatsapp", status: "read", message_id: "wamid.hello", typing_indicator: { type: "text" } },
      { messaging_product: "whatsapp", recipient_type: "individual", to: ALICE.phone, type: "text", text: { preview_url: false, body: "Hello back." } },
    ]);
    expect(claude.requests).toHaveLength(1);
    expect(claude.requests[0].system[0].text).toBe(LIVE_PROMPT);
    expect(claude.requests[0].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hello" }] }]);
  });

  it("keeps the conversation in one session and sends the same context every turn", async () => {
    const claude = mockClaude(text("One."), text("Two."));
    await say("First");
    await settle();
    await say("Second");
    await settle();
    expect(claude.requests[1].system).toEqual(claude.requests[0].system);
    expect(claude.requests[1].model).toBe(claude.requests[0].model);
    expect(claude.requests[1].messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    const sessions = await inBrain(ALICE, (brain) => brain.listSessions());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ user_turns: 2, ended_at: null, reflection_status: "not_ended" });
    expect(sessions[0].turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "First"],
      ["assistant", "One."],
      ["user", "Second"],
      ["assistant", "Two."],
    ]);
  });

  it("saves what note records and drops the message text from the inbox once it's handled", async () => {
    mockClaude({ content: [{ type: "tool_use", name: "note", input: { fact: "Works nights" } }] }, text("Good to know."));
    await say("I work nights");
    await settle();
    expect(sentTexts(graph).map((r) => r.text.body)).toEqual(["Good to know."]);
    await inBrain(ALICE, (brain, state) => {
      expect(brain.listSessions()[0].facts).toEqual(["Works nights"]);
      expect(state.storage.sql.exec("SELECT text, handled_at IS NOT NULL AS handled FROM inbox").toArray()).toEqual([{ text: "", handled: 1 }]);
    });
  });

  it("sends nothing when Claude has nothing to say, and joins the next message to the open one", async () => {
    const claude = mockClaude({ content: [] }, text("Still here."));
    await say("ok");
    await settle();
    expect(sentTexts(graph)).toEqual([]);
    await say("hello?");
    await settle();
    expect(claude.requests[1].messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "ok" },
          { type: "text", text: "hello?" },
        ],
      },
    ]);
  });

  it("apologises when the turn fails, saves nothing and can carry on", async () => {
    const claude = mockClaude({ content: [], stop_reason: "refusal" }, text("Here now."));
    await say("First try");
    await settle();
    expect(sentTexts(graph).map((r) => r.text.body)).toEqual([REPLIES.turnFailed]);
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[0]).toMatchObject({ user_turns: 0, turns: [] });
    await say("Second try");
    await settle();
    expect(claude.requests[1].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Second try" }] }]);
    expect(sentTexts(graph).at(-1)!.text.body).toBe("Here now.");
  });

  it("still saves the turn when WhatsApp won't take the reply, and doesn't run it twice", async () => {
    const claude = mockClaude(text("Hello."));
    graph.status = 500;
    await say("Hi");
    await settle();
    await settle();
    expect(claude.requests).toHaveLength(1);
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[0].user_turns).toBe(1);
  });

  it("answers messages that arrive mid-turn together, as the next turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const claude = mockClaude({ ...text("First answer."), after: gate }, text("Second answer."));
    await say("one");
    void runDurableObjectAlarm(await brainFor(ALICE));
    await vi.waitFor(() => expect(claude.requests).toHaveLength(1));

    await say("two");
    await say("three");
    expect(sentTexts(graph)).toEqual([]);
    release();

    await vi.waitFor(() => expect(sentTexts(graph)).toHaveLength(2));
    await settle();
    expect(sentTexts(graph).map((r) => r.text.body)).toEqual(["First answer.", "Second answer."]);
    expect(claude.requests).toHaveLength(2);
    expect(claude.requests[1].messages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "two\nthree" }] });
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[0].user_turns).toBe(2);
  });
});

describe("echo mode", () => {
  it("sends the person's own text back without calling Claude or starting a session", async () => {
    const claude = mockClaude();
    await withEnv({ ECHO_MODE: "true" });
    await say("Is this thing on?");
    await settle();
    expect(sentTexts(graph).map((r) => r.text.body)).toEqual(["Is this thing on?"]);
    expect(claude.requests).toEqual([]);
    expect(await inBrain(ALICE, (brain) => brain.listSessions())).toEqual([]);
  });
});

describe("ending a session", () => {
  const goQuiet = (minutes: number) => inBrain(ALICE, (_, state) => void state.storage.sql.exec("UPDATE sessions SET last_message_at = ? WHERE ended_at IS NULL", minutesAgo(minutes)));

  it("sets the alarm for the idle deadline after a turn", async () => {
    mockClaude(text("Hello."));
    await say("Hi");
    await settle();
    const alarm = await inBrain(ALICE, (_, state) => state.storage.getAlarm());
    expect(alarm).toBeGreaterThan(Date.now() + (IDLE_MINUTES - 1) * 60_000);
    expect(alarm).toBeLessThanOrEqual(Date.now() + IDLE_MINUTES * 60_000);
  });

  it("leaves a session open while it's inside the idle window", async () => {
    const claude = mockClaude(text("Hello."));
    await say("Hi");
    await settle();
    await goQuiet(IDLE_MINUTES - 5);
    await runDurableObjectAlarm(await brainFor(ALICE));
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[0]).toMatchObject({ ended_at: null });
    expect(claude.requests).toHaveLength(1);
  });

  it("ends an idle session on the alarm, reflects on it and files what it learned", async () => {
    const claude = mockClaude(text("Hello."), reflectionReply());
    await say("Keep it short please");
    await settle();
    await goQuiet(IDLE_MINUTES + 1);
    expect(await runDurableObjectAlarm(await brainFor(ALICE))).toBe(true);

    expect(claude.requests).toHaveLength(2);
    expect(claude.requests[1]).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "high" } });
    expect(claude.requests[1].messages[0].content).toContain("User: Keep it short please");
    await inBrain(ALICE, async (brain, state) => {
      const [session] = brain.listSessions();
      expect(session).toMatchObject({ end_reason: "idle", reflection_status: "done", reflection: { summary: "Asked about fake things. Ended happy.", preferences: ["Prefers short answers"] } });
      expect(session.reflection!.note).toMatch(/^sessions\/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.md$/);
      expect(brain.getProfile().learned).toEqual(["Prefers short answers"]);
      expect(state.storage.sql.exec("SELECT path FROM files ORDER BY path").toArray().map((r) => r.path)).toEqual(["USER.md", "interests.md", session.reflection!.note]);
      // Nothing is left to wait for, so the alarm isn't set again.
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect(sentTexts(graph)).toHaveLength(1);
  });

  it("ends a chat sooner when IDLE_MINUTES is set, and keeps 30 minutes when it's junk", async () => {
    mockClaude(text("Hello."), reflectionReply(), text("Hello again."));
    await withEnv({ IDLE_MINUTES: "1" });
    await say("Hi");
    await settle();
    expect(await inBrain(ALICE, (_, state) => state.storage.getAlarm())).toBeLessThanOrEqual(Date.now() + 60_000);
    await goQuiet(2);
    await runDurableObjectAlarm(await brainFor(ALICE));
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[0]).toMatchObject({ end_reason: "idle", reflection_status: "done" });

    await withEnv({ IDLE_MINUTES: "soon" });
    await say("Hi again");
    await settle();
    await goQuiet(2);
    await runDurableObjectAlarm(await brainFor(ALICE));
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[1]).toMatchObject({ ended_at: null });
  });

  it("starts a new session that remembers the last one", async () => {
    const claude = mockClaude(text("Hello."), reflectionReply(), text("Welcome back."));
    await say("Keep it short please");
    await settle();
    await goQuiet(IDLE_MINUTES + 1);
    await runDurableObjectAlarm(await brainFor(ALICE));
    await say("Me again");
    await settle();

    const context = claude.requests[2].system[1].text as string;
    expect(context).toContain("- Prefers short answers ([[sessions/");
    expect(context).toContain("Asked about fake things. Ended happy.");
    expect(claude.requests[2].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Me again" }] }]);
    expect((await inBrain(ALICE, (brain) => brain.listSessions())).map((s) => s.reflection_status)).toEqual(["done", "not_ended"]);
  });

  it("ends an idle session when the next message arrives, even if the alarm hasn't fired", async () => {
    const claude = mockClaude(text("Hello."), text("New chat."), reflectionReply());
    await say("Hi");
    await settle();
    await goQuiet(IDLE_MINUTES + 1);
    await say("Hi again");
    await settle();
    const sessions = await inBrain(ALICE, (brain) => brain.listSessions());
    expect(sessions.map((s) => [s.end_reason, s.user_turns, s.reflection_status])).toEqual([
      ["idle", 1, "done"],
      [null, 1, "not_ended"],
    ]);
    expect(claude.requests[1].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hi again" }] }]);
  });

  it("ends a session that started on an earlier London day", async () => {
    mockClaude(text("Hello."), reflectionReply());
    await say("Hi");
    await settle();
    await inBrain(ALICE, (_, state) => void state.storage.sql.exec("UPDATE sessions SET started_at = ?", minutesAgo(25 * 60)));
    await runDurableObjectAlarm(await brainFor(ALICE));
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[0]).toMatchObject({ end_reason: "midnight", reflection_status: "done" });
  });

  it("ends a session at the turn cap", async () => {
    mockClaude(text("Hello."), reflectionReply());
    await say("Hi");
    await inBrain(ALICE, (brain, state) => {
      brain.getProfile();
      state.storage.sql.exec("INSERT INTO sessions (id, model, context, user_turns, started_at, last_message_at) VALUES ('capped', 'claude-sonnet-5-5', 'context', ?, ?, ?)", TURN_CAP - 1, minutesAgo(1), minutesAgo(1));
    });
    await settle();
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[0]).toMatchObject({ id: "capped", user_turns: TURN_CAP, end_reason: "turn_cap", reflection_status: "done" });
  });

  it("tries a reflection again later when Claude is down, then files it", async () => {
    mockClaude(text("Hello."), { status: 529, message: "Overloaded" }, { status: 529, message: "Overloaded" }, reflectionReply());
    await say("Hi");
    await settle();
    await goQuiet(IDLE_MINUTES + 1);
    await runDurableObjectAlarm(await brainFor(ALICE));
    await inBrain(ALICE, async (brain, state) => {
      expect(brain.listSessions()[0]).toMatchObject({ end_reason: "idle", reflection_status: "pending" });
      const alarm = await state.storage.getAlarm();
      expect(alarm).toBeGreaterThan(Date.now());
      expect(alarm).toBeLessThanOrEqual(Date.now() + REFLECTION_RETRY_MINUTES[0] * 60_000);
      state.storage.sql.exec("UPDATE sessions SET reflect_after = ?", minutesAgo(1));
    });
    await runDurableObjectAlarm(await brainFor(ALICE));
    expect((await inBrain(ALICE, (brain) => brain.listSessions()))[0]).toMatchObject({ reflection_status: "done" });
  });

  it("doesn't retry a reflection that can't succeed", async () => {
    const claude = mockClaude(text("Hello."), text("not json"));
    await say("Hi");
    await settle();
    await goQuiet(IDLE_MINUTES + 1);
    await runDurableObjectAlarm(await brainFor(ALICE));
    await inBrain(ALICE, async (brain, state) => {
      expect(brain.listSessions()[0]).toMatchObject({ reflection_status: "failed", reflection: null });
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect(claude.requests).toHaveLength(2);
  });
});

describe("a play session", () => {
  const sockSorting = { activity: "Fake sock sorting", setup: "Tip out the socks.", location: "home", props: ["socks"], minutes: 45 };
  const suggest = (play = sockSorting) => ({ content: [{ type: "text" as const, text: `Try ${play.activity}.` }, { type: "tool_use" as const, name: "start_play", input: play }] });
  const plays = () =>
    inBrain(ALICE, (_, state) =>
      state.storage.sql
        .exec<{ frontmatter: string; body: string }>("SELECT frontmatter, body FROM files WHERE kind = 'play' ORDER BY json_extract(frontmatter, '$.started_at'), path")
        .toArray()
        .map((r) => ({ ...JSON.parse(r.frontmatter), body: r.body })),
    );
  const endChat = async () => {
    await inBrain(ALICE, (_, state) => void state.storage.sql.exec("UPDATE sessions SET last_message_at = ? WHERE ended_at IS NULL", minutesAgo(IDLE_MINUTES + 1)));
    await runDurableObjectAlarm(await brainFor(ALICE));
  };
  const startedAgo = (minutes: number) => inBrain(ALICE, (_, state) => void state.storage.sql.exec("UPDATE files SET frontmatter = json_set(frontmatter, '$.started_at', ?) WHERE kind = 'play'", minutesAgo(minutes)));

  it("opens when an activity is suggested and waits past the end of the chat for a check-in", async () => {
    const claude = mockClaude(suggest(), reflectionReply(), { content: [{ type: "tool_use", name: "check_in", input: { went: "loved", minutes: 50, feedback: "Sorted every sock twice." } }] }, text("Brilliant."));
    await say("I need an hour, we're at home");
    await settle();
    expect(await plays()).toMatchObject([{ activity: "Fake sock sorting", location: "home", props: ["socks"], planned_minutes: 45, status: "open", body: "# Fake sock sorting\n\nTip out the socks.\n" }]);

    await endChat();
    await say("That went brilliantly, nearly an hour");
    await settle();

    const context = claude.requests[3].system[1].text as string;
    expect(context).toContain("# Fake sock sorting");
    expect(context).toMatch(/# Waiting for a check-in\n\nplays\/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.md is still open/);
    expect(await plays()).toMatchObject([{ status: "done", went: "loved", minutes: 50, body: "# Fake sock sorting\n\nTip out the socks.\n\n## How it went\n\nSorted every sock twice.\n" }]);
  });

  it("drops a suggestion that was turned down in the same chat", async () => {
    mockClaude(suggest(), suggest({ ...sockSorting, activity: "Fake cushion mountain" }));
    await say("I need an hour, we're at home");
    await settle();
    await say("Something else?");
    await settle();
    expect((await plays()).map((p) => [p.activity, p.status])).toEqual([["Fake cushion mountain", "open"]]);
  });

  it("saves nothing to the play log when the turn fails", async () => {
    mockClaude({ content: [{ type: "tool_use", name: "start_play", input: sockSorting }] }, { content: [], stop_reason: "refusal" });
    await say("I need an hour, we're at home");
    await settle();
    expect(await plays()).toEqual([]);
  });

  it("asks once how it went, a while after the activity was meant to end", async () => {
    mockClaude(suggest(), reflectionReply());
    await say("I need an hour, we're at home");
    await settle();
    await endChat();
    const alarm = await inBrain(ALICE, (_, state) => state.storage.getAlarm());
    expect(alarm).toBeGreaterThan(Date.now() + (sockSorting.minutes + NUDGE_AFTER_MINUTES - 1) * 60_000);
    expect(alarm).toBeLessThanOrEqual(Date.now() + (sockSorting.minutes + NUDGE_AFTER_MINUTES) * 60_000);
    expect(sentTexts(graph)).toHaveLength(1);

    await startedAgo(sockSorting.minutes + NUDGE_AFTER_MINUTES + 1);
    await runDurableObjectAlarm(await brainFor(ALICE));
    await runDurableObjectAlarm(await brainFor(ALICE));

    expect(sentTexts(graph).map((r) => r.text.body)).toEqual(["Try Fake sock sorting.", REPLIES.nudge("Fake sock sorting")]);
    expect((await plays())[0]).toMatchObject({ status: "open", nudged_at: expect.any(String) });
    expect(await inBrain(ALICE, (_, state) => state.storage.getAlarm())).toBeNull();
  });

  it("asks sooner when NUDGE_AFTER_MINUTES is set", async () => {
    mockClaude(suggest(), reflectionReply());
    await withEnv({ NUDGE_AFTER_MINUTES: "1" });
    await say("I need an hour, we're at home");
    await settle();
    await endChat();
    const alarm = await inBrain(ALICE, (_, state) => state.storage.getAlarm());
    expect(alarm).toBeGreaterThan(Date.now() + sockSorting.minutes * 60_000);
    expect(alarm).toBeLessThanOrEqual(Date.now() + (sockSorting.minutes + 1) * 60_000);

    await startedAgo(sockSorting.minutes + 2);
    await runDurableObjectAlarm(await brainFor(ALICE));
    expect(sentTexts(graph).at(-1)?.text.body).toBe(REPLIES.nudge("Fake sock sorting"));
  });

  it("doesn't ask when the parent has already checked in, or while they're still chatting", async () => {
    mockClaude(suggest(), { content: [{ type: "tool_use", name: "check_in", input: { went: "flop", minutes: 5, feedback: "Wandered off." } }] }, text("Noted."), suggest());
    await say("I need an hour, we're at home");
    await settle();
    await say("That was over in five minutes");
    await settle();
    await startedAgo(sockSorting.minutes + NUDGE_AFTER_MINUTES + 1);
    await runDurableObjectAlarm(await brainFor(ALICE));

    await say("Another one please");
    await settle();
    await startedAgo(sockSorting.minutes + NUDGE_AFTER_MINUTES + 1);
    await runDurableObjectAlarm(await brainFor(ALICE));

    expect(sentTexts(graph).map((r) => r.text.body)).not.toContain(REPLIES.nudge("Fake sock sorting"));
  });
});

describe("the dev tools", () => {
  const DEV_URL = `https://build40for40.com${BASE_PATH}/dev`;
  const request = async (body: Record<string, unknown>) => {
    const raw = JSON.stringify({ user_id: ALICE.userId, ...body });
    return new Request(DEV_URL, { method: "POST", headers: { "X-Hub-Signature-256": await sign(raw, env.WHATSAPP_APP_SECRET) }, body: raw });
  };
  const withTools = (r: Request) => worker.fetch(r as Parameters<typeof worker.fetch>[0], { ...env, DEV_TOOLS: "true" }, createExecutionContext());
  const dev = async (body: Record<string, unknown>) => (await (await withTools(await request(body))).json()) as Record<string, any>;

  it("aren't there unless DEV_TOOLS is on: the path is a 404 like any other", async () => {
    const [off, unknown] = [await exports.default.fetch(await request({ command: "memory" })), await exports.default.fetch(`https://build40for40.com${BASE_PATH}/nothing-here`, { method: "POST" })];
    expect(off.status).toBe(404);
    expect(await off.text()).toBe(await unknown.text());
    expect((await withTools(new Request(DEV_URL, { method: "POST", body: "{}" }))).status).toBe(401);
  });

  it("end the open chat, reflect on it and say which notes changed", async () => {
    mockClaude(text("Hello."), reflectionReply());
    await say("Hi");
    await settle();
    const outcome = await dev({ command: "end" });
    expect(outcome.ended).toEqual({ reason: "idle", reflection: "done", error: null });
    expect(outcome.changed).toEqual(["USER.md", "interests.md", expect.stringMatching(/^sessions\//)]);
    expect(outcome.state).toMatchObject({ chat_open: false, play_waiting: null });

    const memory = await dev({ command: "memory", path: "interests.md" });
    expect(memory.notes).toMatchObject([{ path: "interests.md", body: expect.stringContaining("Loves fake diggers") }]);
  });

  it("skip time, so the chat ends and then the nudge goes out", async () => {
    const play = { activity: "Fake sock sorting", setup: "Tip out the socks.", location: "home", props: ["socks"], minutes: 45 };
    mockClaude({ content: [{ type: "text", text: "Try it." }, { type: "tool_use", name: "start_play", input: play }] }, reflectionReply());
    await say("I need an hour, we're at home");
    await settle();

    expect((await dev({ command: "advance", minutes: IDLE_MINUTES - 1 })).state).toMatchObject({ chat_open: true });
    expect(await dev({ command: "advance", minutes: 2 })).toMatchObject({ ended: { reason: "idle", reflection: "done" }, state: { chat_open: false, play_waiting: expect.stringMatching(/^plays\//) } });
    expect(sentTexts(graph)).toHaveLength(1);

    const outcome = await dev({ command: "advance", minutes: play.minutes + NUDGE_AFTER_MINUTES });
    expect(sentTexts(graph).at(-1)?.text.body).toBe(REPLIES.nudge("Fake sock sorting"));
    expect(outcome).toMatchObject({ changed: [expect.stringMatching(/^plays\//)], state: { next_alarm: null } });
  });
});

describe("a picture on a suggestion", () => {
  const play = { activity: "Fake dino bath", setup: "Fill a bowl.", location: "home", props: ["dinosaurs"], minutes: 20 };
  const suggest = (picture: string, picture_brief = "") => ({ content: [{ type: "text" as const, text: "Try a dino bath." }, { type: "tool_use" as const, name: "start_play", input: { ...play, picture, picture_brief } }] });
  const images = () => graph.requests.filter((r) => r.type === "image");

  it("lists the pictures in the context and sends the chosen one with the reply as its caption", async () => {
    const claude = mockClaude(suggest("toy-bath"));
    await say("Ada loves dinosaurs, we're at home");
    await settle();
    expect(claude.requests[0].system[1].text).toContain("- toy-bath: Toys having a bath");
    expect(images()).toEqual([expect.objectContaining({ to: ALICE.phone, image: { link: `${env.PUBLIC_BASE_URL}${BASE_PATH}/pictures/toy-bath.png`, caption: "Try a dino bath." } })]);
    expect(sentTexts(graph)).toEqual([]);
    const note = await inBrain(ALICE, (_, state) => JSON.parse(state.storage.sql.exec<{ frontmatter: string }>("SELECT frontmatter FROM files WHERE kind = 'play'").one().frontmatter));
    expect(note.picture).toBe("toy-bath");
  });

  it("sends the reply without a picture and asks for one to be drawn when none fits", async () => {
    const activity = `Fake swamp ${crypto.randomUUID().slice(0, 8)}`;
    play.activity = activity;
    mockClaude(suggest("", "toy cars in a fake swamp"));
    await say("Something new please, we're at home");
    await settle();
    play.activity = "Fake dino bath";
    expect(images()).toEqual([]);
    expect(sentTexts(graph)).toHaveLength(1);
    const shelf = env.PICTURE_SHELF.get(env.PICTURE_SHELF.idFromName("pictures"));
    const wanted = await runInDurableObject(shelf, (_, state) => state.storage.sql.exec<{ brief: string }>("SELECT brief FROM wanted WHERE id = ?", activity.toLowerCase().replaceAll(" ", "-")).toArray());
    expect(wanted).toEqual([{ brief: "toy cars in a fake swamp" }]);
    await runInDurableObject(shelf, (_, state) => void state.storage.sql.exec("DELETE FROM wanted"));
  });

  it("sends no picture for an id that doesn't exist", async () => {
    mockClaude(suggest("no-such-picture"));
    await say("Something to do, we're at home");
    await settle();
    expect(images()).toEqual([]);
    expect(sentTexts(graph)).toHaveLength(1);
  });
});

describe("/forget", () => {
  it("wipes everything the brain holds and says so", async () => {
    const claude = mockClaude(text("Hello."));
    await say("I work nights");
    await settle();
    await say(" /Forget ");
    await settle();

    expect(sentTexts(graph).map((r) => r.text.body)).toEqual(["Hello.", REPLIES.forgotten]);
    expect(claude.requests).toHaveLength(1);
    await inBrain(ALICE, async (_, state) => {
      expect(tables(state)).toEqual([]);
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("starts from nothing afterwards", async () => {
    const claude = mockClaude(text("Hello."), reflectionReply(), text("Hello, stranger."));
    await say("Keep it short please");
    await settle();
    await inBrain(ALICE, (_, state) => void state.storage.sql.exec("UPDATE sessions SET last_message_at = ?", minutesAgo(IDLE_MINUTES + 1)));
    await runDurableObjectAlarm(await brainFor(ALICE));
    expect(await inBrain(ALICE, (brain) => brain.getProfile().learned)).toEqual(["Prefers short answers"]);

    await say("/forget");
    await settle();
    await say("Hi");
    await settle();

    expect(claude.requests[2].system[1].text).not.toContain("Prefers short answers");
    expect(claude.requests[2].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
    await inBrain(ALICE, (brain) => {
      expect(brain.getProfile().learned).toEqual([]);
      expect(brain.listSessions()).toHaveLength(1);
    });
  });

  it("answers a message sent straight after it with a fresh brain", async () => {
    const claude = mockClaude(text("Fresh start."));
    await postWebhook(fakeWebhook({ messages: [fakeMessage({ body: "Remember this" }), fakeMessage({ body: "/forget" }), fakeMessage({ body: "Hello again" })] }));
    await settle();
    expect(sentTexts(graph).map((r) => r.text.body)).toEqual([REPLIES.forgotten, "Fresh start."]);
    expect(claude.requests).toHaveLength(1);
    expect(claude.requests[0].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hello again" }] }]);
  });

  it("only leaves the other person's brain alone", async () => {
    mockClaude(text("Hello Bob."));
    await say("I'm Bob", BOB);
    await settle(BOB);
    await say("/forget", ALICE);
    await settle(ALICE);
    expect(await inBrain(BOB, (brain) => brain.listSessions())).toHaveLength(1);
  });
});
