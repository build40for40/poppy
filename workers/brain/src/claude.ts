import Anthropic from "@anthropic-ai/sdk";
import { LIVE_PROMPT } from "./prompt";
import { tools } from "./tools";

export const DEFAULT_LIVE_MODEL = "claude-sonnet-5-5";
export const MAX_TOKENS = 16_000;

export function liveModel(env: Pick<Env, "LIVE_MODEL">): string {
  return env.LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
}

export function createClient(apiKey: string, timeout = 60_000): Anthropic {
  return new Anthropic({
    apiKey,
    maxRetries: 1,
    timeout,
    // The Workers global can throw "Illegal invocation" when it's called unbound.
    fetch: (input, init) => fetch(input, init),
  });
}

/** Thinking off where the model allows it, for the quickest reply. Sonnet 5.5 rejects `disabled`; Haiku 5.5 takes it. */
export function thinkingFor(model: string): Anthropic.ThinkingConfigParam | undefined {
  if (model.startsWith("claude-sonnet-5-5")) return { type: "between_tools" };
  if (model.startsWith("claude-haiku-5-5")) return { type: "disabled" };
  return undefined;
}

/** The prompt, then the session's context with a cache breakpoint. Both are identical on every turn of a session. */
export function systemBlocks(context: string): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: LIVE_PROMPT },
    { type: "text", text: context, cache_control: { type: "ephemeral" } },
  ];
}

export function liveRequest(model: string, context: string, messages: Anthropic.MessageParam[]): Anthropic.MessageCreateParamsNonStreaming {
  const thinking = thinkingFor(model);
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: systemBlocks(context),
    tools: tools as unknown as Anthropic.Tool[],
    messages,
    cache_control: { type: "ephemeral" },
    output_config: { effort: "low" },
    ...(thinking ? { thinking } : {}),
  };
}
