import type Anthropic from "@anthropic-ai/sdk";
import { liveRequest } from "./claude";
import { parseCheckIn, parseStart, type PlayEvent } from "./plays";
import type { ToolCall, Turn } from "./types";

export const MAX_ROUNDS = 4;

export interface TurnInput {
  client: Anthropic;
  model: string;
  context: string;
  /** The history, ending with the user's new message. */
  messages: Anthropic.MessageParam[];
  /** Whether a play session is waiting for a check-in as the turn starts. */
  playOpen?: boolean;
  now?: () => string;
}

export interface TurnOutcome {
  /** The history to store, raw: thinking blocks go back to Claude unchanged. */
  messages: Anthropic.MessageParam[];
  turns: Turn[];
  facts: string[];
  plays: PlayEvent[];
  /** The whole reply as one string, empty when Claude had nothing to say. */
  text: string;
  timings: { total_ms: number; rounds: number };
  usage: Pick<Anthropic.Usage, "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens">[];
}

export class TurnError extends Error {}

interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** Adds what the user just sent to the history. If the last message is still theirs (a silent reply, or tool results waiting), it joins that one. */
export function appendUserText(messages: Anthropic.MessageParam[], text: string): Anthropic.MessageParam[] {
  const block: Anthropic.TextBlockParam = { type: "text", text };
  const last = messages.at(-1);
  if (last?.role === "user") return [...messages.slice(0, -1), { role: "user", content: [...blocks(last), block] }];
  return [...messages, { role: "user", content: [block] }];
}

/** Runs one turn: calls Claude, runs its tools here and goes round again until it has finished replying. */
export async function runTurn({ client, model, context, messages: history, playOpen = false, now = () => new Date().toISOString() }: TurnInput): Promise<TurnOutcome> {
  const started = Date.now();
  const messages = [...history];
  const turns: Turn[] = [];
  const facts: string[] = [];
  const state: ToolState = { facts, plays: [], playOpen };
  const usage: TurnOutcome["usage"] = [];
  const said: string[] = [];
  const outcome = (rounds: number): TurnOutcome => ({ messages, turns, facts, plays: state.plays, text: state.suggestion ?? said.join("\n\n"), timings: { total_ms: Date.now() - started, rounds }, usage });

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const message = await client.messages.stream(liveRequest(model, context, messages)).finalMessage();
    usage.push(message.usage);
    if (message.stop_reason === "refusal") throw new TurnError("Claude declined to reply.");
    if (message.stop_reason === "max_tokens") throw new TurnError("The reply ran out of room.");

    const text = message.content
      .flatMap((b) => (b.type === "text" ? [b.text.trim()] : []))
      .filter(Boolean)
      .join("\n\n");
    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    // The API rejects an empty assistant message, so a silent reply isn't stored and the user's next words join their open message.
    if (!text && !toolUses.length) return outcome(round);

    messages.push({ role: "assistant", content: message.content as Anthropic.ContentBlockParam[] });
    if (text) said.push(text);

    const recorded: ToolCall[] = [];
    const results = toolUses.map((use) => runTool(use, state, recorded));
    const suggested = recorded.some((call) => call.name === "start_play");
    const shown = suggested ? state.suggestion : text;
    turns.push({ role: "assistant", at: now(), ...(shown ? { text: shown } : {}), ...(recorded.length ? { tool_calls: recorded } : {}) });

    if (!results.length) return outcome(round);
    // Every tool_use needs its result in the very next user message, all together.
    messages.push({ role: "user", content: results.map((r): Anthropic.ToolResultBlockParam => ({ type: "tool_result", ...r })) });
    if (message.stop_reason !== "tool_use") return outcome(round);
    // The suggestion is the whole reply. Asked to carry on after it, Claude signs off a second time.
    if (suggested && results.every((r) => !r.is_error)) return outcome(round);
  }
  throw new TurnError(`Still calling tools after ${MAX_ROUNDS} rounds.`);
}

interface ToolState {
  facts: string[];
  plays: PlayEvent[];
  playOpen: boolean;
  /** The message of the suggestion made this turn, which is sent in place of anything written around the tool call. */
  suggestion?: string;
}

/** Runs one tool call here in the Durable Object. A bad call goes back to Claude as an error result, so it can try again. */
function runTool(use: Anthropic.ToolUseBlock, state: ToolState, recorded: ToolCall[]): ToolResult {
  const failed = (content: string): ToolResult => ({ tool_use_id: use.id, content, is_error: true });
  if (use.name === "note") {
    const fact = (use.input as { fact?: unknown } | null)?.fact;
    if (typeof fact !== "string" || !fact.trim()) return failed("note needs {fact}: one short fact, never empty.");
    state.facts.push(fact.trim());
    recorded.push({ id: use.id, name: "note", input: { fact: fact.trim() } });
    return { tool_use_id: use.id, content: "saved" };
  }
  if (use.name === "start_play") {
    const play = parseStart(use.input);
    if (typeof play === "string") return failed(play);
    state.plays.push({ type: "start", play });
    state.playOpen = true;
    state.suggestion = play.message;
    const { message: _, ...details } = play;
    recorded.push({ id: use.id, name: "start_play", input: details });
    return { tool_use_id: use.id, content: "sent to the parent, waiting for their check-in" };
  }
  if (use.name === "check_in") {
    if (!state.playOpen) return failed("No play session is waiting for a check-in.");
    const checkIn = parseCheckIn(use.input);
    if (typeof checkIn === "string") return failed(checkIn);
    state.plays.push({ type: "check_in", checkIn });
    state.playOpen = false;
    recorded.push({ id: use.id, name: "check_in", input: { ...checkIn } });
    return { tool_use_id: use.id, content: "saved" };
  }
  return failed(`There's no tool called ${use.name}.`);
}

function blocks(message: Anthropic.MessageParam): Anthropic.ContentBlockParam[] {
  return typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
}
