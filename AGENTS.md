# Poppy

Day 7 of 40 for 40, built live on Twitch on Tuesday 10 November 2026. Poppy is a play helper for parents of small children: a parent who needs an hour messages her on WhatsApp, she suggests one activity for the child, and she remembers how each one went.

- **Form factor:** an assistant parents talk to on WhatsApp, which remembers each family between conversations.
- **Layout:** `workers/brain` is the only component: a Cloudflare Worker that takes the WhatsApp webhook, in front of one `UserBrain` Durable Object per person. Its README is the spec. Setup and the local sandbox runbook are in `README.md`.
- **Where it came from:** the brain is the Sous brain (Day 5, `sous/workers/brain`) with the cooking taken out. The kit's `agent-memory` skill says what was kept and why.
- **Tracking:** the Superthread `day7` board. The architecture review card lists the decisions and the known unknowns.

Shared 40 for 40 context lives in `../AGENTS.md`.

## Decided

- The assistant reuses the Sous brain: a markdown vault per person, live Claude turns, and a reflection after each conversation that files what it learned.
- People reach it on WhatsApp through Meta's WhatsApp Cloud API, starting on Meta's test number.
- One Worker, with the webhook route and the Durable Object together.
- A person is known by what Meta's verified webhook says about the sender, never by anything typed in a message. There's no sign-in.
- `/forget` deletes everything the brain holds about the sender.
- Deploys go through CI, never by hand.
- Poppy only suggests play activities and records how they went. Anything else is politely out of scope.
- A chat and a play session are different things. A chat ends after 30 minutes quiet. A play session opens when Poppy suggests an activity and stays open until the parent checks in, however many chats that takes.
- Memory is `USER.md` (the child and the family), `interests.md` (a running note of what the child is into), `plays/` (one note per play session, with how it went) and `sessions/` (one note per chat).
- About the child, Poppy keeps age, boy or girl, a nickname and whatever else helps pick activities. No surname, address or school.
- Poppy confirms where the family is before suggesting, suggests one activity, then stops.
- Poppy messages first exactly once per play session: a check-in nudge an hour after the activity was meant to end, if nobody has said how it went.

## Still open

- Onboarding. Today Poppy only asks the child's age when she doesn't know it, and learns the rest as it comes up
- Saved play locations, each with what's there to play with. Today a location is free text on the play session
- More than one child per WhatsApp number
- Whether it reads voice notes or images
