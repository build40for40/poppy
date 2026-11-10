import type Anthropic from "@anthropic-ai/sdk";

/**
 * The tools Claude can call during a live turn. They all run inside the Durable Object: WhatsApp has no client to hand a tool to.
 * Strict schemas reject `minLength` and friends, so limits live in the description and are checked in `turn.ts`.
 * TODO(product): add the tools the assistant needs, and run each one in `runTool` in `turn.ts`.
 */
export const tools = [
  {
    name: "note",
    description: "Save one lasting fact about the person you're talking to, worth remembering in future conversations. It's kept for later; they don't see it.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["fact"],
      properties: {
        fact: { type: "string", description: "One short fact, in plain words. Never empty." },
      },
    },
  },
] as const satisfies readonly Anthropic.Tool[];
