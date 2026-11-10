import type { JsonValue } from "./profile";

/** A tool the assistant ran during a turn: a fact it kept, an activity it suggested or a check-in it recorded. */
export interface ToolCall {
  id: string;
  name: "note" | "start_play" | "check_in";
  input: { [key: string]: JsonValue };
}

/** One line of the transcript the reflection reads. Raw Claude messages are stored separately. */
export type Turn = { role: "user"; at: string; text: string } | { role: "assistant"; at: string; text?: string; tool_calls?: ToolCall[] };
