import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, liveRequest, thinkingFor } from "./claude";
import { LIVE_PROMPT } from "./prompt";
import { mockClaude } from "./testing";
import { appendUserText, MAX_ROUNDS, runTurn, TurnError } from "./turn";

afterEach(() => {
  vi.restoreAllMocks();
});

const run = (...replies: Parameters<typeof mockClaude>) => runWith({}, ...replies);

function runWith({ playOpen = false }: { playOpen?: boolean }, ...replies: Parameters<typeof mockClaude>) {
  const claude = mockClaude(...replies);
  const outcome = runTurn({
    client: createClient(env.ANTHROPIC_API_KEY),
    model: "claude-sonnet-5-5",
    context: "context",
    messages: [{ role: "user", content: [{ type: "text", text: "Hello there." }] }],
    playOpen,
    now: () => "2026-11-10T18:00:00Z",
  });
  return { claude, outcome };
}

describe("liveRequest", () => {
  it("sends tools, then the prompt and the cached context, then the conversation", () => {
    const request = liveRequest("claude-sonnet-5-5", "the context", [{ role: "user", content: "hi" }]);
    expect(request.system).toEqual([
      { type: "text", text: LIVE_PROMPT },
      { type: "text", text: "the context", cache_control: { type: "ephemeral" } },
    ]);
    expect(request.tools).toMatchObject([
      { name: "note", strict: true },
      { name: "start_play", strict: true },
      { name: "check_in", strict: true },
    ]);
    expect(request).toMatchObject({ model: "claude-sonnet-5-5", cache_control: { type: "ephemeral" }, output_config: { effort: "low" }, thinking: { type: "between_tools" } });
    expect(request).not.toHaveProperty("tool_choice");
  });

  it("picks the thinking setting each model accepts", () => {
    expect(thinkingFor("claude-sonnet-5-5")).toEqual({ type: "between_tools" });
    expect(thinkingFor("claude-haiku-5-5")).toEqual({ type: "disabled" });
    expect(thinkingFor("claude-opus-5-5")).toBeUndefined();
  });
});

describe("appendUserText", () => {
  it("starts a new user message after an assistant reply", () => {
    expect(appendUserText([{ role: "assistant", content: [{ type: "text", text: "Hi." }] }], "Hello")).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Hi." }] },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);
  });

  it("joins a user message that's still open, after any tool results", () => {
    const open = [{ role: "user" as const, content: [{ type: "tool_result" as const, tool_use_id: "toolu_1", content: "saved" }] }];
    expect(appendUserText(open, "And another thing")).toEqual([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "saved" },
          { type: "text", text: "And another thing" },
        ],
      },
    ]);
  });
});

describe("runTurn", () => {
  it("returns the reply as text and for the history", async () => {
    const { outcome } = run({ content: [{ type: "text", text: "Hello back." }] });
    const result = await outcome;
    expect(result.text).toBe("Hello back.");
    expect(result.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "Hello back." }] });
    expect(result.turns).toEqual([{ role: "assistant", at: "2026-11-10T18:00:00Z", text: "Hello back." }]);
    expect(result.timings.rounds).toBe(1);
    expect(result.usage).toHaveLength(1);
  });

  it("runs note itself, hands the result back and carries on to the reply", async () => {
    const { claude, outcome } = run(
      {
        content: [
          { type: "text", text: "Noted." },
          { type: "tool_use", id: "toolu_note", name: "note", input: { fact: "  Works nights " } },
        ],
      },
      { content: [{ type: "text", text: "What else?" }] },
    );
    const result = await outcome;
    expect(result.facts).toEqual(["Works nights"]);
    expect(result.text).toBe("Noted.\n\nWhat else?");
    expect(claude.requests).toHaveLength(2);
    expect(claude.requests[1].messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_note", content: "saved" }] });
    expect(result.turns).toEqual([
      { role: "assistant", at: "2026-11-10T18:00:00Z", text: "Noted.", tool_calls: [{ id: "toolu_note", name: "note", input: { fact: "Works nights" } }] },
      { role: "assistant", at: "2026-11-10T18:00:00Z", text: "What else?" },
    ]);
  });

  it("tells Claude what was wrong with a bad or unknown tool call instead of running it", async () => {
    const { claude, outcome } = run(
      {
        content: [
          { type: "tool_use", id: "bad_note", name: "note", input: { fact: "  " } },
          { type: "tool_use", id: "no_tool", name: "send_money", input: {} },
        ],
      },
      { content: [{ type: "text", text: "Sorry about that." }] },
    );
    const result = await outcome;
    expect(result.facts).toEqual([]);
    expect(claude.requests[1].messages.at(-1).content).toEqual([
      { type: "tool_result", tool_use_id: "bad_note", content: expect.stringContaining("never empty"), is_error: true },
      { type: "tool_result", tool_use_id: "no_tool", content: "There's no tool called send_money.", is_error: true },
    ]);
    expect(result.text).toBe("Sorry about that.");
  });

  const sockSorting = { activity: "Fake sock sorting", setup: "Tip out the socks.", location: "home", props: ["socks"], minutes: 45, picture: "", pictureBrief: "" };
  const lovedIt = { went: "loved", minutes: 50, feedback: "Sorted every sock twice." };

  it("ends the reply at a suggestion, so Claude isn't asked to sign off twice", async () => {
    const { claude, outcome } = run({ content: [{ type: "text", text: "Try sock sorting." }, { type: "tool_use", id: "toolu_start", name: "start_play", input: sockSorting }] });
    const result = await outcome;
    expect(claude.requests).toHaveLength(1);
    expect(result.text).toBe("Try sock sorting.");
    expect(result.plays).toEqual([{ type: "start", play: sockSorting }]);
    expect(result.turns[0].role === "assistant" && result.turns[0].tool_calls).toEqual([{ id: "toolu_start", name: "start_play", input: sockSorting }]);
    expect(result.messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_start", content: "saved, waiting for their check-in" }] });
  });

  it("records a check-in and then a new suggestion in one reply", async () => {
    const { outcome } = runWith(
      { playOpen: true },
      { content: [{ type: "tool_use", id: "toolu_check", name: "check_in", input: lovedIt }] },
      { content: [{ type: "text", text: "Try sock sorting." }, { type: "tool_use", id: "toolu_start", name: "start_play", input: sockSorting }] },
    );
    expect((await outcome).plays).toEqual([
      { type: "check_in", checkIn: lovedIt },
      { type: "start", play: sockSorting },
    ]);
  });

  it("only takes a check-in when a play session is waiting for one", async () => {
    const refused = run({ content: [{ type: "tool_use", id: "toolu_check", name: "check_in", input: lovedIt }] }, { content: [{ type: "text", text: "Which activity was that?" }] });
    expect((await refused.outcome).plays).toEqual([]);
    expect(refused.claude.requests[1].messages.at(-1).content).toEqual([{ type: "tool_result", tool_use_id: "toolu_check", content: "No play session is waiting for a check-in.", is_error: true }]);
    vi.restoreAllMocks();

    const taken = runWith({ playOpen: true }, { content: [{ type: "tool_use", name: "check_in", input: lovedIt }] }, { content: [{ type: "text", text: "Lovely." }] });
    expect((await taken.outcome).plays).toEqual([{ type: "check_in", checkIn: lovedIt }]);
  });

  it("keeps a silent reply out of the history", async () => {
    const { outcome } = run({ content: [] });
    const result = await outcome;
    expect(result.text).toBe("");
    expect(result.turns).toEqual([]);
    expect(result.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Hello there." }] }]);
  });

  it("gives up on a refusal, a reply that ran out of room and endless tool calls", async () => {
    await expect(run({ content: [], stop_reason: "refusal" }).outcome).rejects.toThrow(TurnError);
    vi.restoreAllMocks();
    await expect(run({ content: [{ type: "text", text: "Too lo" }], stop_reason: "max_tokens" }).outcome).rejects.toThrow(TurnError);
    vi.restoreAllMocks();
    const forever = Array.from({ length: MAX_ROUNDS }, () => ({ content: [{ type: "tool_use" as const, name: "note", input: { fact: "again" } }] }));
    await expect(run(...forever).outcome).rejects.toThrow(`Still calling tools after ${MAX_ROUNDS} rounds.`);
  });

  it("fails when Claude is down or the stream breaks", async () => {
    await expect(run({ status: 529, message: "Overloaded" }, { status: 529, message: "Overloaded" }).outcome).rejects.toThrow();
    vi.restoreAllMocks();
    await expect(run({ breakAfter: [{ type: "text", text: "Hel" }] }).outcome).rejects.toThrow();
  });
});
