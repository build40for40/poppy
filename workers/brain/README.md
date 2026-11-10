# Brain

A Cloudflare Worker in front of one `UserBrain` Durable Object per person, each with its own SQLite. The Worker takes Meta's WhatsApp webhook. The Durable Object holds what the assistant knows about that person, talks to Claude and sends the replies.

It's the Sous brain (Day 5) with the cooking removed and WhatsApp put where the phone app was. Product decisions haven't been made, and every place that waits on one is marked `TODO(product)`.

## Routes

Everything lives under `/poppy/api`. There is one path.

| route | does |
| --- | --- |
| `GET /whatsapp` | Meta's verify handshake. With `hub.mode=subscribe` and a `hub.verify_token` equal to `WHATSAPP_VERIFY_TOKEN` it answers `200` with `hub.challenge`. Otherwise `403` |
| `POST /whatsapp` | Meta's webhook. Checks `X-Hub-Signature-256` against the raw body, hands each incoming message to its sender's Durable Object and answers `200`. `401 bad_signature`, `400 invalid_json`, `413 body_too_large`, `503 whatsapp_unavailable` if the app secret isn't set |

There's no API for a person to call. Nobody signs in: the only way in is a webhook Meta signed.

## From a message to a reply

1. **Signature first.** The Worker reads the body as text and checks `X-Hub-Signature-256` (`sha256=` then the HMAC SHA-256 of the raw body under the app secret, compared in constant time) before anything parses it (`verifySignature` in `src/whatsapp.ts`).
2. **Pick out the messages.** `incomingMessages` keeps messages people sent to this business number. Delivery statuses (sent, delivered, read), other webhook fields and other numbers are dropped. Text is kept. Images, voice notes, video, documents, stickers, locations and contacts are marked unsupported. Reactions and system notices are ignored.
3. **Find the person.** Meta sends a business-scoped user id (`from_user_id`) with each message, and may leave the phone number out for people who use a WhatsApp username. The person's identity is that user id when it's there and the number otherwise (`identityOf`), and their Durable Object is named with the hex SHA-256 of it, so no number appears in an object name or a log line. The object stores the number or user id it needs to reply to.
4. **Store, then answer Meta.** `UserBrain.receive` puts the message in the object's `inbox` table and sets its alarm for now. A message id that's already there is dropped, because Meta redelivers webhooks for up to seven days. That takes milliseconds, so the `200` goes back fast, and Meta only gets it once the message is safely stored.
5. **The alarm does the work.** One run at a time, it takes everything unhandled in the inbox as one turn (several messages are joined with line breaks), marks the last one read with a typing indicator, runs the turn and sends the reply as one WhatsApp message, split only if it's over 4,096 characters.
6. **Messages that arrive mid-turn** wait in the inbox and are answered together as the next turn, in the same alarm run.

If the turn fails, the person gets a short apology and nothing is saved, so their next message starts from the same history. If WhatsApp refuses the reply, the turn is still saved and isn't run again.

## Sessions

A chat has no end button, so the brain decides when a conversation is over. One session is open at a time. It ends when:

- nothing has arrived for `IDLE_MINUTES` (30),
- it reaches `TURN_CAP` (40) user turns, or
- the London day it started on is over.

Both constants are in `src/brain.ts`. Sessions matter because the context is assembled once, when a session starts: `USER.md`, `MEMORY.md`, the five newest session notes and the London date (`src/prompt.ts`). It's stored on the session row with the model, so every turn sends a byte-identical prefix and the prompt cache holds. What a session learns reaches the next session, not the current one.

Each turn sends Claude the tools, then the prompt and the context (cached with a breakpoint), then the conversation (top-level automatic caching), on Sonnet 5.5 at `low` effort with thinking `between_tools`. The only tool is `note(fact)`, which runs in the Durable Object: the fact is saved on the session and Claude carries on. An empty reply isn't stored (the API rejects an empty assistant message), so the person's next words join their still-open message. Every turn logs a `brain_turn` line with timings and token usage, including cache reads.

## Reflection

When a session ends, the alarm reflects on it: one `claude-opus-5-5` call (`src/reflection.ts`, effort `high`, structured output against `reflectionSchema`) reads `USER.md`, the transcript and the noted facts, and returns a `summary` and `preferences` (new, lasting facts about the person). Code checks the output against the schema, tidies it and writes the vault in one transaction (`src/vault.ts`):

- `sessions/<London date>-<id prefix>.md`: the summary and what was learned.
- `USER.md`: the new facts under `## Learned in conversation`, skipping ones already there. The person's own text above it is never touched.

Every line a session adds carries that session's `[[wikilink]]`, and a rerun replaces that session's lines, so reflecting twice changes nothing. After writing, the `links` table is thrown away and rebuilt from every note's wikilinks.

If Claude is down or rate limited, the reflection is tried again after 1, 5, 30 and 120 minutes (`REFLECTION_RETRY_MINUTES`), then saved as failed. A refusal or output that doesn't fit the schema won't improve, so it's saved as failed straight away.

## The alarm

A Durable Object has one alarm, so it does everything in order: answer the inbox, end sessions that are due, reflect on ended sessions, answer anything that arrived meanwhile, then set itself for whichever comes first out of the open session's idle deadline, London midnight and the next reflection retry. A new message always sets it to now.

One thing to know: a message that arrives while a reflection is running waits for it to finish. The upside is that the new session's context then includes what the last one learned.

## Forgetting

`/forget`, sent as a message on its own, wipes the whole Durable Object: the vault, every session, the inbox, the stored number and the alarm. The person gets a confirmation, and their next message meets a brain that has never seen them. WhatsApp and Meta keep their own copy of the chat, and the confirmation says so.

## Privacy

- One person, one Durable Object. Nothing is shared between people and nothing goes to the site's D1.
- Phone numbers, message text, prompts and vault content are never logged. Log lines carry event names, session ids, timings, token usage and Meta's error codes.
- The hash in the object name keeps numbers out of names and logs. It isn't encryption: the number is stored inside the object, and `/forget` is what deletes it.
- Message text reaches the prompt and, through reflection, the vault. The prompts treat it as what the person said and never as instructions, and the reflection only has two narrow fields. Keep both true as the product grows.
- Fixtures are fake: the phone numbers are from Ofcom's range reserved for TV drama, and no real conversation is ever pasted into a test.

## Configuration

| Name | Kind | What it is |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret | Without it, people get "can't reply right now" and reflections wait |
| `WHATSAPP_APP_SECRET` | secret | The Meta app's secret. Checks every webhook's signature |
| `WHATSAPP_TOKEN` | secret | The access token for sending |
| `WHATSAPP_VERIFY_TOKEN` | secret | A string we choose, for the verify handshake |
| `WHATSAPP_PHONE_NUMBER_ID` | secret | The business number's id. Webhooks for any other number are ignored |
| `WHATSAPP_API_VERSION` | var | The Graph API version, `v27.0` |
| `LIVE_MODEL` | var | The model for live turns. New sessions pick up a change; open ones keep theirs |
| `ECHO_MODE` | var | `true` sends the person's own text back and never calls Claude |

For local runs they go in `.dev.vars` (copy `.dev.vars.example`). The root README has the runbook.

## Files

| File | What's in it |
| --- | --- |
| `src/index.ts` | The Worker: the two routes |
| `src/whatsapp.ts` | Signature check, webhook parsing, identity, the send client |
| `src/brain.ts` | The Durable Object: inbox, turns, sessions, reflection, the alarm, wipe |
| `src/turn.ts` | One live turn with Claude, running tools here |
| `src/claude.ts`, `src/tools.ts`, `src/prompt.ts` | The request shape, the tool list, the prompt and context |
| `src/reflection.ts` | The reflection schema, prompt, call and retry rules |
| `src/vault.ts`, `src/wikilinks.ts` | Notes, sections, links, London dates |
| `src/schema.ts`, `src/seed.ts` | Migrations and the starter `USER.md` |
| `src/testing.ts` | Fake Claude, fake WhatsApp, fake people and signed fake webhooks |

## What to fill in for the product

Search for `TODO(product)`. In short:

- `src/prompt.ts`: who the assistant is and how it sounds
- `src/tools.ts` and `runTool` in `src/turn.ts`: the tools it needs
- `src/reflection.ts`: what's worth remembering, as schema fields
- `src/vault.ts`, `src/wikilinks.ts` and `src/schema.ts`: the notes those fields are filed into
- `src/brain.ts`: `IDLE_MINUTES`, `TURN_CAP` and the canned replies
