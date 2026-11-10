# What parents see on WhatsApp

**Status: 10 November 2026.** This is the message design from the Day 7 stream. The shapes of the three message types are built into Poppy's prompt (`workers/brain/src/prompt.ts`, "Your three kinds of message"). Claude keeps each shape and fits the words to the family. Anything marked _proposed_ needs new code and hasn't been agreed by the team or built yet.

Poppy sends parents three kinds of message, which go round in a loop: **suggest → review → look back → suggest again.** Every example below uses the same family: Ada, 3, into dinosaurs, and a parent making dinner.

## 1. Pre-play: the suggestion

The parent asks for something to keep the child busy. Poppy replies with one activity, built from what it knows about the child (`USER.md`, `interests.md`, the play log). The reply opens a play session (`start_play`).

What the parent sends:

> My daughter Ada is 3 and she loves dinosaurs right now. I need something she can play with while I keep an eye on her and make dinner.

What Poppy sends back:

> Dino bath time
> 3 min to set up · keeps Ada busy for 15–20 min
>
> Grab: plastic dinos, a bowl with a little soapy water, an old toothbrush, a towel
> Then: put it all on the kitchen floor where you can see her, and tell her the dinos got muddy and need a bath.
>
> Builds hand strength and pretend play, and she won't need you once she's started. Keep the water shallow.
>
> [ Another idea ] [ Missing stuff ] [ She loved it! ]

The rules for writing it:

- **Order matters.** What to grab and what to do come first, because the parent is reading one-handed. Skills and the reason come after, squeezed into one line.
- **The "why" is about this family.** For example: her dinosaur phase, the kitchen, not needing the parent. Not a generic line about learning.
- **The setup line names the child and says how long the activity lasts.** For a busy parent, "keeps her busy for" matters more than the setup time.
- **Safety gets one short line when it's relevant** (water, small parts). The full safety rules are already in the prompt.
- **It fits on one phone screen.** If there's a picture, the text under it must stay under WhatsApp's limit of about 1,000 characters.
- **Missing items get swapped, not refused.** If the parent says "no toothbrush", Poppy suggests a sponge or a washcloth. Poppy also remembers what the family usually has (`note`), so later suggestions fit their house.

_Proposed:_

- **Reply buttons.** A message can have up to 3, each with a label of up to 20 characters. Twilio offers them through its own message templates, so check they work in the sandbox before relying on them.
- **A picture at the top of the card.** It should come from a set of pictures made ahead of time and checked by a person, not generated live or pulled from the web. A picture showing deep water or small parts would contradict the safety line in the text.

## 2. Activity review: after play

The parent says how it went, either unprompted or in answer to Poppy's one check-in. That check-in goes out an hour after the activity was meant to end, and that part is already built. Each review closes the play session (`check_in`: `went`, `minutes`, `feedback`) and shapes the next suggestion.

> How did dino bath time go?
> [ Loved it ] [ It was ok ] [ Not for her ]
>
> → How long did it keep her busy? [ Under 10 min ] [ 10–20 min ] [ 20+ min ]
> → Anything to change next time? (type it, or skip)
>
> Saved. Next time you're cooking, just say "dinner time" and I'll build on this.

The three buttons line up with the `went` values already in the code: `loved`, `fine` and `flop`. If the answer is "Not for her", Poppy asks one gentle question about why (for example, the water, or just not the mood tonight) instead of dropping it.

The rules for the review:

- **Ask one question per message.** Every answer is optional. Never a form.
- **Show that Poppy uses what it hears.** For example, "Since Ada loved the water one…". Seeing that is what makes parents share more.

_Proposed: voice notes._ A parent at the stove would rather say "she loved it, went for ages, wants more dinos" than tap buttons. How it would work:

1. Poppy downloads the audio. With Twilio, the link is in `MediaUrl0`; see the `TODO(product)` in `twilio.ts`.
2. The audio is turned into text, for example with Cloudflare's Workers AI Whisper model, so there's no new provider.
3. The text goes through the same turn as a typed message.
4. Poppy repeats back what it heard before saving: "Got it: a hit, 20+ minutes, wants more dinos. Saved. Reply if I got anything wrong."
5. Only the text is kept, never the audio. A voice note may have the child's voice in it.
6. The review message tells parents they can do this: "Tap below, or send me a voice note."

## 3. History: looking back

The parent asks what the child has been doing. Poppy reads the play log back and points at what's next.

> What has Ada been doing lately?
>
> Ada's recent play
> • Tue 10 Nov: Dino bath time, loved it, 20+ min
> • Sun 8 Nov: Dino café, it was ok, ~10 min
> • Thu 5 Nov: Sticker dino eggs, loved it, ~15 min
>
> Water play is her favourite so far. Want to repeat one, or try something new?
> [ Repeat dino bath ] [ Something new ] [ Show more ]

Today, the last ten play notes already reach Claude in every chat. So Poppy can answer this question now from the play log, without new code.

_Proposed:_

- **A "History" button** on the other messages.
- **A way to see further back** than the last ten.

## Still to decide

- **Buttons and pictures:** whether Poppy sends them, which means interactive messages and Twilio message templates.
- **Voice notes:** whether Poppy reads them. This is already open in `CLAUDE.md`.
- **A history command:** whether the history list needs its own command.

The prompt now allows WhatsApp's single-asterisk bold, but only for the activity name, the Grab and Then labels, and the heading of the history list.
