# Brain

A Cloudflare Worker in front of one `UserBrain` Durable Object per person, each with its own SQLite. The Worker takes WhatsApp webhooks, from Meta's Cloud API or from Twilio's WhatsApp sandbox as the fallback. The Durable Object holds what the assistant knows about that person, talks to Claude and sends the replies.

It's the Sous brain (Day 5) with the cooking removed and WhatsApp put where the phone app was. Poppy suggests play activities to parents of small children and remembers how each one went.

## Routes

Everything lives under `/poppy/api`. There is one path per provider.

| route | does |
| --- | --- |
| `GET /whatsapp` | Meta's verify handshake. With `hub.mode=subscribe` and a `hub.verify_token` equal to `WHATSAPP_VERIFY_TOKEN` it answers `200` with `hub.challenge`. Otherwise `403` |
| `POST /whatsapp` | Meta's webhook. Checks `X-Hub-Signature-256` against the raw body, hands each incoming message to its sender's Durable Object and answers `200`. `401 bad_signature`, `400 invalid_json`, `413 body_too_large`, `503 whatsapp_unavailable` if the app secret isn't set |

| `GET /pictures/<id>.png` | A picture as a PNG, for Twilio or Meta to fetch and put on a suggestion. Public: pictures hold no one's data. Drawn from the SVG on the first fetch and cached at the edge for a day. `404` for an unknown id |
| `POST /twilio` | Twilio's webhook, one message per request as form fields. Checks `X-Twilio-Signature`, hands the message to its sender's Durable Object and answers `200` with empty TwiML. `401 bad_signature`, `413 body_too_large`, `503 twilio_unavailable` if the auth token isn't set |

| `POST /dev` | Local only. Exists while `DEV_TOOLS` is `true`, and is a `404 not_found` like any unknown path otherwise. Takes the webhook's signature and a JSON body naming a sender and a command: `memory` returns the vault, `end` ends the open chat and reflects, `advance` moves the stored times back and runs the alarm. It returns vault content and logs none of it |

There's no API for a person to call. Nobody signs in: the only way in is a webhook Meta or Twilio signed. Neither provider's secrets are required, so either can run without the other.

## From a message to a reply

1. **Signature first.** The Worker reads the body as text and checks `X-Hub-Signature-256` (`sha256=` then the HMAC SHA-256 of the raw body under the app secret, compared in constant time) before anything parses it (`verifySignature` in `src/whatsapp.ts`).
2. **Pick out the messages.** `incomingMessages` keeps messages people sent to this business number. Delivery statuses (sent, delivered, read), other webhook fields and other numbers are dropped. Text is kept. Images, voice notes, video, documents, stickers, locations and contacts are marked unsupported. Reactions and system notices are ignored.
3. **Find the person.** Meta sends a business-scoped user id (`from_user_id`) with each message, and may leave the phone number out for people who use a WhatsApp username. The person's identity is that user id when it's there and the number otherwise (`identityOf`), and their Durable Object is named with the hex SHA-256 of it, so no number appears in an object name or a log line. The object stores the number or user id it needs to reply to.
4. **Store, then answer Meta.** `UserBrain.receive` puts the message in the object's `inbox` table and sets its alarm for now. A message id that's already there is dropped, because Meta redelivers webhooks for up to seven days. That takes milliseconds, so the `200` goes back fast, and Meta only gets it once the message is safely stored.
5. **The alarm does the work.** One run at a time, it takes everything unhandled in the inbox as one turn (several messages are joined with line breaks), marks the last one read with a typing indicator, runs the turn and sends the reply as one WhatsApp message, split only if it's over 4,096 characters.
6. **Messages that arrive mid-turn** wait in the inbox and are answered together as the next turn, in the same alarm run.

If the turn fails, the person gets a short apology and nothing is saved, so their next message starts from the same history. If WhatsApp refuses the reply, the turn is still saved and isn't run again.

## Through Twilio instead

The Twilio route does the same job with Twilio's shapes (`src/twilio.ts`):

- **Signature.** `X-Twilio-Signature` is the base64 HMAC SHA-1, under the auth token, of the URL Twilio called followed by every form field's name and value, sorted by name. It's checked against the raw form body before the message is used. The URL is the request's own. Behind a tunnel the Worker sees a different host than Twilio called, so `PUBLIC_BASE_URL` gives a second address to check against. Forwarded-host headers aren't trusted.
- **The message.** One per request. It must be for our account and one of our sender numbers, from a `whatsapp:+…` address. A body is text. Media (voice notes included) and locations are marked unsupported. `incomingTwilioMessage` has the `TODO(product)` where voice-note transcription plugs in.
- **Repeats.** Twilio's `MessageSid` goes in the same inbox, so a repeat is dropped the same way.
- **Who they are.** The identity is `twilio:` then the number, hashed, so the same phone on Meta and on Twilio is two separate brains. The object remembers which provider the person's messages come through and replies the same way.
- **Replies.** Through Twilio's Messages API with the account SID and auth token, from the sender number the person last wrote to, split at 1,600 characters. The sandbox sends one message every three seconds, so the pieces of a long reply are sent 3.1 seconds apart (`TWILIO_SEND_GAP_MS`). There's no read receipt or typing indicator.
- **Replies in the webhook's answer.** With `TWILIO_REPLY_INLINE` on, the Worker waits for the brain to answer (`answerNow`) and hands the reply back as TwiML, one `<Message>` per piece, the picture as `<Media>`. Twilio gives a webhook 15 seconds, so the brain only hands back what's ready within 12. A slower reply, a message that arrives while another is being answered, and the check-in nudge still go through the API.

`/forget`, echo mode, sessions and reflection don't know which provider is in use.

## Sessions

A chat has no end button, so the brain decides when a conversation is over. One session is open at a time. It ends when:

- nothing has arrived for `IDLE_MINUTES` (30),
- it reaches `TURN_CAP` (40) user turns, or
- the London day it started on is over.

Both constants are in `src/brain.ts`. Sessions matter because the context is assembled once, when a session starts: `USER.md`, `interests.md`, `MEMORY.md`, the ten newest play sessions, the play session waiting for a check-in, the five newest session notes and the London time and date (`src/prompt.ts`). It's stored on the session row with the model, so every turn sends a byte-identical prefix and the prompt cache holds. What a session learns reaches the next session, not the current one.

Each turn sends Claude the tools, then the prompt and the context (cached with a breakpoint), then the conversation (top-level automatic caching), on Sonnet 5.5 at `low` effort with thinking `between_tools`. The tools are `note(fact)`, `start_play` and `check_in`. They all run in the Durable Object. After `note` or `check_in` Claude carries on in the same turn. `start_play` ends it: the suggestion is the tool's own `message`, which is sent as the whole reply in place of anything Claude wrote around the call. What they recorded is saved with the turn, in one transaction, so a turn that fails leaves nothing behind. An empty reply isn't stored (the API rejects an empty assistant message), so the person's next words join their still-open message. Every turn logs a `brain_turn` line with timings and token usage, including cache reads.

## Play sessions

A chat and a play session are different things. Mum asks at 14:00, the child plays for an hour and she checks in at 15:05, long after the 30 minute chat has ended. So a play session is its own note, `plays/<London date>-<id prefix>.md`, and it outlives the chat it started in (`src/plays.ts`).

- **`start_play`** is how a suggestion is sent. It carries the message the parent reads, plus the activity, the set-up, the location, the props and how long it's meant to last. It writes the note with `status: open`.
- **Only one is open at a time.** A second `start_play` in the same chat means the first suggestion was turned down, so that note is deleted. One left open by an earlier chat is closed as `no_check_in`.
- **`check_in`** closes the open play session with `went` (`loved`, `fine` or `flop`), how many minutes it lasted when the parent said, and their feedback under `## How it went`. With nothing open it goes back to Claude as an error.
- **Every new chat is told** which play session is still waiting, so a check-in that arrives hours later lands on the right one.
- **The nudge.** If a play session is still open `NUDGE_AFTER_MINUTES` (60) after it was meant to end, the alarm sends one message asking how it went and stamps `nudged_at` on the note. It's sent once, never while a chat is open, and it's always inside WhatsApp's 24 hour window because the parent wrote at most four hours earlier.

## Pictures

Every suggestion goes out with a picture on top, the reply as its caption (`src/pictures.ts`, `src/shelf.ts`).

- **The set.** Thirty starter pictures of the most common activities live in `src/starter-pictures.ts`, hand-drawn in one flat style: a scene (`indoor`, `outdoor` or `floor`) with plain shapes on top, no people and no words. Every new chat lists them in the context, by id and a one-line description.
- **Choosing.** `start_play` carries `picture`, the id Claude chose, and the brain sends it if it exists. It's saved on the play note.
- **When none fits,** Claude leaves `picture` empty and writes `picture_brief` in general words, and the reply goes without a picture. The brain hands the brief to the `PictureShelf` Durable Object, one shared by every family, which draws it on its own alarm with Opus. The parent never waits for it. The drawing has to be plain shapes (`checkBody`) and has to render, or it's thrown away. Failed drawings are retried twice, then dropped.
- **Next time.** A new picture joins the set straight away, so the next chat whose activity it fits gets it. No one approves it first. Every one is logged as `picture_drawn` with its id and description. To look at one, open `/poppy/api/pictures/<id>.png`. To delete one, call `remove(id)` on the shelf.
- **Limits.** At most 40 drawings a day, 300 in all and 20 waiting, so a loop can't run up a bill.
- **Sending.** Twilio gets `MediaUrl` and Meta an `image` message with a `link`, both pointing at `PICTURES_BASE_URL`, or at `PUBLIC_BASE_URL` behind a tunnel. A reply longer than WhatsApp's 1,024 character caption goes as the picture on its own, then the text.

## Reflection

When a session ends, the alarm reflects on it: one `claude-opus-5-5` call (`src/reflection.ts`, effort `high`, structured output against `reflectionSchema`) reads `USER.md`, `interests.md`, the transcript and the noted facts, and returns a `summary`, `preferences` (new, lasting facts about the child and the family) and `interests` (what the child is into, or isn't). Code checks the output against the schema, tidies it and writes the vault in one transaction (`src/vault.ts`):

- `sessions/<London date>-<id prefix>.md`: the summary and what was learned.
- `USER.md`: the new facts under `## Learned in conversation`, skipping ones already there. The person's own text above it is never touched.
- `interests.md`: the new interests under `## What they're into`, the same way. It's one running note, created the first time there's something to put in it.

Every line a session adds carries that session's `[[wikilink]]`, and a rerun replaces that session's lines, so reflecting twice changes nothing. After writing, the `links` table is thrown away and rebuilt from every note's wikilinks.

If Claude is down or rate limited, the reflection is tried again after 1, 5, 30 and 120 minutes (`REFLECTION_RETRY_MINUTES`), then saved as failed. A refusal or output that doesn't fit the schema won't improve, so it's saved as failed straight away.

## The alarm

A Durable Object has one alarm, so it does everything in order: answer the inbox, end sessions that are due, reflect on ended sessions, send the check-in nudge if it's due, answer anything that arrived meanwhile, then set itself for whichever comes first out of the open session's idle deadline, London midnight, the next reflection retry and the nudge. A new message always sets it to now.

One thing to know: a message that arrives while a reflection is running waits for it to finish. The upside is that the new session's context then includes what the last one learned.

## Forgetting

`/forget`, sent as a message on its own, wipes the whole Durable Object: the vault, every session, the inbox, the stored number and the alarm. The person gets a confirmation, and their next message meets a brain that has never seen them. WhatsApp and Meta keep their own copy of the chat, and the confirmation says so.

## Privacy

- One person, one Durable Object. Nothing is shared between people and nothing goes to the site's D1.
- Phone numbers, message text, prompts and vault content are never logged. Log lines carry event names, session ids, timings, token usage and Meta's error codes.
- The hash in the object name keeps numbers out of names and logs. It isn't encryption: the number is stored inside the object, and `/forget` is what deletes it.
- Message text reaches the prompt and, through reflection, the vault. The prompts treat it as what the person said and never as instructions, and the reflection only has three narrow fields. Keep both true as the product grows.
- This is data about a child. Poppy keeps age, boy or girl, a nickname and what helps pick activities. The prompts tell her not to ask for or record a surname, an address or a school.
- Fixtures are fake: the phone numbers are from Ofcom's range reserved for TV drama, and no real conversation is ever pasted into a test.

## Configuration

| Name | Kind | What it is |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret | Without it, people get "can't reply right now" and reflections wait |
| `WHATSAPP_APP_SECRET` | secret | The Meta app's secret. Checks every webhook's signature |
| `WHATSAPP_TOKEN` | secret | The access token for sending |
| `WHATSAPP_VERIFY_TOKEN` | secret | A string we choose, for the verify handshake |
| `WHATSAPP_PHONE_NUMBER_ID` | secret | The business number's id. Webhooks for any other number are ignored |
| `TWILIO_ACCOUNT_SID` | secret | The Twilio account. Webhooks for any other account are ignored |
| `TWILIO_AUTH_TOKEN` | secret | Checks every Twilio webhook's signature and sends every Twilio reply |
| `TWILIO_WHATSAPP_FROM` | secret | The sender, as `whatsapp:+` then the number. Several senders go in one value, separated by commas. Messages to any other number are ignored, and each person is answered from the number they wrote to |
| `PUBLIC_BASE_URL` | var | Only for Twilio behind a tunnel: the tunnel's address, so the signature check knows the URL Twilio called |
| `TWILIO_REPLY_INLINE` | var | `true` sends the reply to a Twilio message back in the webhook's own answer, as TwiML, and not through Twilio's API. On for now, because the Twilio account can't send through the API until its compliance profile is approved |
| `WEB_CHAT` | var | `true` switches on the landing page's demo chat at `POST /poppy/api/web`. It takes `{ "id": "<uuid the browser made>", "text": "<up to 500 characters>" }` and answers `{ "replies": [{ "text", "picture" }], "left" }`. Nobody signs it, so it's capped: 10 messages per visitor (`429 visitor_limit`), 500 a day across everyone (`429 daily_limit`, counted by the `WebGate` object), and each visitor's brain is deleted a day after their first message. A demo chat is never reflected on or nudged |
| `WHATSAPP_API_VERSION` | var | The Graph API version, `v27.0` |
| `LIVE_MODEL` | var | The model for live turns. New sessions pick up a change; open ones keep theirs |
| `ECHO_MODE` | var | `true` sends the person's own text back and never calls Claude |
| `WHATSAPP_API_BASE` | local only | Where replies go instead of `https://graph.facebook.com`. `npm run chat` listens there |
| `IDLE_MINUTES` | local only | Minutes of quiet before a chat ends, in place of 30 |
| `NUDGE_AFTER_MINUTES` | local only | Minutes after an activity's planned end before the nudge, in place of 60 |
| `DEV_TOOLS` | local only | `true` adds `POST /dev`, which the terminal chat's `/memory`, `/end` and `/advance` call |

For local runs they go in `.dev.vars` (copy `.dev.vars.example`). The root README has the runbook for each provider. The four marked local only exist for the terminal chat (`npm run chat`, `scripts/chat.mjs`). They're never set in `wrangler.jsonc` or by the deploy workflow, and a timing that's empty or isn't a positive number falls back to the constant.

The secrets are typed by hand in `src/env.d.ts`, because `wrangler.jsonc` lists none as required. `npm run types` regenerates `worker-configuration.d.ts`; it also reads `.dev.vars`, so move that file aside while it runs to keep the result the same on every machine.

## Files

| File | What's in it |
| --- | --- |
| `src/index.ts` | The Worker: the routes |
| `src/whatsapp.ts` | Meta: signature check, webhook parsing, the send client. Also identity and message splitting, shared by both |
| `src/twilio.ts` | Twilio: signature check, webhook parsing, the send client |
| `src/env.d.ts` | Types for the secrets that aren't required |
| `src/brain.ts` | The Durable Object: inbox, turns, sessions, reflection, the alarm, wipe |
| `src/turn.ts` | One live turn with Claude, running tools here |
| `src/claude.ts`, `src/tools.ts`, `src/prompt.ts` | The request shape, the tool list, the prompt and context |
| `src/plays.ts` | Play sessions: checking the tool calls, the notes, the one open session, when to nudge |
| `src/pictures.ts`, `src/starter-pictures.ts` | The picture style, the thirty starter pictures, the shape check and drawing to PNG |
| `src/shelf.ts` | The shared `PictureShelf` Durable Object: drawn pictures, and drawing new ones |
| `src/reflection.ts` | The reflection schema, prompt, call and retry rules |
| `src/vault.ts`, `src/wikilinks.ts` | Notes, sections, links, London dates |
| `src/schema.ts`, `src/seed.ts` | Migrations and the starter `USER.md` |
| `src/testing.ts` | Fake Claude, fake Meta, fake Twilio, fake people and signed fake webhooks |
| `scripts/chat.mjs` | The terminal chat: plays Meta on both sides of a Worker running under `npm run dev` |
