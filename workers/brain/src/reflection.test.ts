import { env } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./claude";
import { isRetryable, reflect, ReflectionError, reflectionRequest, renderTranscript, type ReflectionInput } from "./reflection";
import { fakeReflection, mockClaude } from "./testing";
import type { Turn } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

const turns: Turn[] = [
  { role: "user", at: "2026-11-10T18:00:00Z", text: "Keep it short please." },
  { role: "assistant", at: "2026-11-10T18:00:02Z", text: "Will do.", tool_calls: [{ id: "toolu_1", name: "note", input: { fact: "Prefers short answers" } }] },
];

const input: ReflectionInput = { user: { preferences: {}, about: "# About me" }, turns, facts: ["Prefers short answers"] };

const reply = (output: unknown) => ({ content: [{ type: "text" as const, text: typeof output === "string" ? output : JSON.stringify(output) }] });

describe("reflectionRequest", () => {
  it("asks Opus for structured output with everything the reflection reads", () => {
    const request = reflectionRequest(input);
    expect(request).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "high", format: { type: "json_schema" } } });
    expect(request).not.toHaveProperty("thinking");
    expect(request).not.toHaveProperty("tool_choice");
    const content = request.messages[0].content as string;
    expect(content).toContain("# About me");
    expect(content).toContain("User: Keep it short please.");
    expect(content).toContain("- Prefers short answers");
  });
});

describe("renderTranscript", () => {
  it("writes who said what, and the tools the assistant used", () => {
    expect(renderTranscript(turns)).toBe(['User: Keep it short please.', "Assistant: Will do.", '(Assistant used note {"fact":"Prefers short answers"})'].join("\n"));
  });
});

describe("reflect", () => {
  const client = () => createClient(env.ANTHROPIC_API_KEY);

  it("checks and tidies what Opus returns", async () => {
    mockClaude(reply(fakeReflection));
    const { reflection } = await reflect(client(), input);
    expect(reflection).toEqual({ summary: "Asked about fake things. Ended happy.", preferences: ["Prefers short answers"] });
  });

  it("won't retry a refusal, output that isn't JSON or output off the schema", async () => {
    for (const bad of [{ content: [], stop_reason: "refusal" as const }, reply("not json"), reply({ summary: "No list." }), reply({ ...fakeReflection, extra: true })]) {
      mockClaude(bad);
      const failure = await reflect(client(), input).catch((e) => e);
      expect(failure).toBeInstanceOf(ReflectionError);
      expect(isRetryable(failure)).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it("retries when Claude is down, rate limited or unreachable, and not when the request itself is wrong", () => {
    const apiError = (status: number) => Anthropic.APIError.generate(status, { type: "error", error: { type: "api_error", message: "fake" } }, "fake", new Headers());
    for (const status of [408, 409, 429, 500, 529]) expect(isRetryable(apiError(status))).toBe(true);
    for (const status of [400, 401, 403, 404]) expect(isRetryable(apiError(status))).toBe(false);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });
});
