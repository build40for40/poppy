import type Anthropic from "@anthropic-ai/sdk";

/**
 * The tools Claude can call during a live turn. They all run inside the Durable Object: WhatsApp has no client to hand a tool to.
 * Strict schemas reject `minLength` and friends, so limits live in the descriptions and are checked in `plays.ts` and `turn.ts`.
 */
export const tools = [
  {
    name: "note",
    description: "Save one lasting fact about the child or the family, worth remembering in future conversations. It's kept for later; they don't see it.",
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
  {
    name: "start_play",
    description:
      "Record the activity you are suggesting, in the same reply as the suggestion. It opens a play session that waits for the parent's check-in. Only one is open at a time: calling it again in this conversation replaces the suggestion they turned down.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["activity", "setup", "location", "props", "minutes", "picture", "picture_brief"],
      properties: {
        activity: { type: "string", description: "A short name for the activity, a few words. Never empty." },
        setup: { type: "string", description: "How the parent sets it up, as you told them. Never empty." },
        location: { type: "string", description: "Where they are, in the parent's words, like home, the garden or the park. Never empty." },
        props: { type: "array", items: { type: "string" }, description: "The things it needs. Empty when it needs nothing." },
        minutes: { type: "integer", description: "How long it's meant to keep the child busy, in minutes, from 5 to 180." },
        picture: { type: "string", description: "The id of the picture from the Pictures list that best shows this activity, sent on top of your reply. Empty when none of them is close." },
        picture_brief: {
          type: "string",
          description: "Only when picture is empty: what a new picture of this activity should show, in a sentence of general words, like \"toy cars racing down a cardboard ramp\". Every family will see it, so no names or details about this family. Empty when you chose a picture.",
        },
      },
    },
  },
  {
    name: "check_in",
    description: "Record how the open play session went, when the parent tells you. It closes the session. Fails when no play session is waiting for a check-in.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["went", "minutes", "feedback"],
      properties: {
        went: { type: "string", enum: ["loved", "fine", "flop"], description: "loved: the child was absorbed. fine: it did the job. flop: bored, upset or over in minutes." },
        minutes: { type: ["integer", "null"], description: "How many minutes it held the child, or null when the parent didn't say." },
        feedback: { type: "string", description: "What the parent said about how it went, in a sentence or two. Never empty." },
      },
    },
  },
] as const satisfies readonly Anthropic.Tool[];
