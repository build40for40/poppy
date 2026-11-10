/** A fact the assistant chose to keep, saved with the `note` tool. */
export interface ToolCall {
  id: string;
  name: "note";
  input: { fact: string };
}

/** One line of the transcript the reflection reads. Raw Claude messages are stored separately. */
export type Turn = { role: "user"; at: string; text: string } | { role: "assistant"; at: string; text?: string; tool_calls?: ToolCall[] };
