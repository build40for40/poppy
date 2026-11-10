# Poppy

Day 7 of 40 for 40, built live on Twitch on Tuesday 10 November 2026. This repo is the scaffolding only. The problem, the guests and every product decision come later, so nothing here assumes what the assistant is for.

- **Form factor:** an assistant people talk to on WhatsApp, which remembers each person between conversations.
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

## Still open

Don't record product, design or prompt choices here until the team has made them. Everything waiting on one is marked `TODO(product)` in the code.

- What the assistant is for, what it's called and how it sounds
- What's worth remembering about someone, and which notes the reflection files beyond one per conversation
- Whether it reads voice notes or images
- Whether it ever messages first (WhatsApp only allows approved, paid templates outside 24 hours of the person's last message)
