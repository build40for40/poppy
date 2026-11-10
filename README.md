# Poppy

A WhatsApp assistant that remembers you. Day 7 of [40 for 40](https://build40for40.com): 40 apps in 40 days, built live on [Twitch](https://www.twitch.tv/40for40).

This is the scaffolding. It can hold a conversation on WhatsApp and remember the person next time, and it doesn't know what it's for yet. Everything that waits on the product is marked `TODO(product)`.

## How it works

```
WhatsApp ──webhook──▶ Worker   build40for40.com/poppy/api/whatsapp   (Meta)
                               build40for40.com/poppy/api/twilio     (Twilio sandbox, the fallback)
                        1. check the provider's signature on the raw body
                        2. hand each message to its sender's Durable Object, answer 200
                              ▼
                      UserBrain Durable Object, one per person
                        inbox ─▶ alarm ─▶ Claude turn ─▶ reply through the WhatsApp API
                                   └────▶ 30 minutes quiet ─▶ reflection ─▶ markdown vault
```

`workers/brain/README.md` has the detail.

## Run the tests

```sh
cd workers/brain
npm install
npm run typecheck
npm test
```

The tests need no accounts and no keys. Claude, Meta and Twilio are all faked.

There are two ways to get WhatsApp messages in. Meta's own Cloud API is the real one. Twilio's WhatsApp sandbox is the fallback for when a Meta developer account isn't available: it needs no Meta login, and it comes with a shared Twilio number that every tester has to join first. The brain is the same either way, and both can be set up at once.

## Local sandbox with Meta: chat to it from your own phone

You need a Meta developer account, [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`) and, for real replies, an Anthropic API key. It takes about an hour the first time.

### 1. Meta dashboard

1. At [developers.facebook.com](https://developers.facebook.com/apps), create an app. Pick the use case that connects to WhatsApp, and a business portfolio when it asks.
2. Open **WhatsApp > API Setup**. Meta gives you a test number and a temporary access token that lasts 24 hours.
3. Under **To**, add your own phone as a recipient and confirm the code WhatsApp sends you. The test number can message up to five phones.
4. Press **Send message** to send yourself the `hello_world` template. If it arrives, the Meta side works.
5. Keep the page open. You need three things from it: the temporary access token, the **Phone number ID** (not the phone number), and the **App secret** from **App settings > Basic**.

### 2. Secrets

```sh
cd workers/brain
cp .dev.vars.example .dev.vars
```

Fill in `.dev.vars`. It's ignored by git, and nothing in it is ever committed.

| Name | What it is |
| --- | --- |
| `WHATSAPP_TOKEN` | The temporary access token from API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | The Phone number ID from API Setup |
| `WHATSAPP_APP_SECRET` | The App secret from App settings > Basic. It signs every webhook |
| `WHATSAPP_VERIFY_TOKEN` | Any long random string you make up, for example the output of `openssl rand -hex 24` |
| `ANTHROPIC_API_KEY` | A Claude API key. Leave it empty while `ECHO_MODE` is on |
| `ECHO_MODE` | `true` sends your own message straight back and never calls Claude. Start with it on |

### 3. Run it and open a tunnel

In one terminal:

```sh
npm run dev
```

In another:

```sh
cloudflared tunnel --url http://localhost:8787
```

cloudflared prints a `https://<random words>.trycloudflare.com` address. It changes every time you restart the tunnel, so step 4 needs redoing when it does.

### 4. Point Meta at it

1. In the Meta dashboard, open **WhatsApp > Configuration**.
2. **Callback URL:** the tunnel address followed by `/poppy/api/whatsapp`.
3. **Verify token:** the same string you put in `WHATSAPP_VERIFY_TOKEN`.
4. Press **Verify and save**. Meta calls the Worker once, and `npm run dev` logs a `GET` that answered 200.
5. Under **Webhook fields**, subscribe to `messages`.

### 5. Say hello

Message the test number from your phone.

- With `ECHO_MODE=true` you get your own words back. That proves the whole round trip: Meta, the tunnel, the signature check, the Durable Object and the send.
- Set `ECHO_MODE=` (empty), add `ANTHROPIC_API_KEY`, restart `npm run dev`, and you're talking to Claude.
- Send `/forget` and it deletes everything it knows about you.

To see memory work without waiting half an hour, lower `IDLE_MINUTES` in `src/brain.ts` to `1` while you play. Chat, wait a minute or two for the reflection, then say hello again. Don't commit that change.

### When it doesn't work

| What you see | Why |
| --- | --- |
| **Verify and save** fails | The tunnel address is stale, the path isn't `/poppy/api/whatsapp`, or the verify token doesn't match `.dev.vars` |
| A `POST` logs `401` | `WHATSAPP_APP_SECRET` is wrong. It's the App secret, not the access token |
| A `POST` logs `200` and nothing comes back | Look for `whatsapp_send_failed` in the log. Status 401 means the 24 hour token ran out. Code 131030 means your phone isn't on the recipient list |
| Nothing is logged at all | The `messages` field isn't subscribed, or the message went to a different number |
| It replies "I can't reply right now" | `ANTHROPIC_API_KEY` is empty and `ECHO_MODE` is off |

## Local sandbox with Twilio: the fallback

You need a Twilio account (a free trial is enough), [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and, for real replies, an Anthropic API key.

### 1. Twilio console

1. Sign up at [twilio.com/try-twilio](https://www.twilio.com/try-twilio) and verify your email and phone.
2. Open the WhatsApp Sandbox: **Messaging > Try it out > Send a WhatsApp message**. If your console doesn't show it, switch to the legacy Console, which is where Twilio keeps the Sandbox.
3. The page shows the sandbox number and a join code. From your own phone, send `join <the code>` to that number on WhatsApp. The sandbox answers to confirm.
4. From the console's account page, note the **Account SID** and the **Auth Token**.

### 2. Secrets

Add these to `workers/brain/.dev.vars`:

| Name | What it is |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | The Account SID, starting `AC` |
| `TWILIO_AUTH_TOKEN` | The Auth Token. It signs every webhook and sends every reply |
| `TWILIO_WHATSAPP_FROM` | The sandbox sender, written the way Twilio does: `whatsapp:+` then the sandbox number with no spaces |
| `PUBLIC_BASE_URL` | The tunnel address from the next step, for example `https://<random words>.trycloudflare.com`. Twilio signs the address it called, and behind a tunnel the Worker can't see that address on its own |
| `ECHO_MODE` | `true` to start with, as above |

### 3. Run it and open a tunnel

The same two commands as for Meta: `npm run dev`, then `cloudflared tunnel --url http://localhost:8787`. Put the tunnel address in `PUBLIC_BASE_URL` and restart `npm run dev`. When the tunnel restarts the address changes, and both `PUBLIC_BASE_URL` and the console need the new one.

### 4. Point Twilio at it

1. In the console, open **Sandbox settings**.
2. **When a message comes in:** the tunnel address followed by `/poppy/api/twilio`, method **POST**.
3. Save.

### 5. Say hello

Message the sandbox number from the phone that joined. Echo mode, real replies and `/forget` work as they do with Meta.

### What's different on the sandbox

- **Everyone joins first.** Each tester sends the join code from their own phone. The join lasts three days, then they send it again.
- **It's Twilio's number,** shared with other Twilio customers and shown with Twilio's logo.
- **Text only, like Meta for now.** A voice note or photo gets a "text only for now" reply.
- **Shorter, slower messages.** One message holds 1,600 characters, and the sandbox sends one message every three seconds, so a long reply arrives in pieces a few seconds apart.
- **A trial account covers 100 WhatsApp messages.**

### When it doesn't work

| What you see | Why |
| --- | --- |
| A `POST` logs `503` | `TWILIO_AUTH_TOKEN` is empty, or `npm run dev` wasn't restarted after editing `.dev.vars` |
| A `POST` logs `401` | `PUBLIC_BASE_URL` isn't the current tunnel address, the URL saved in Twilio isn't exactly the tunnel address plus `/poppy/api/twilio`, or the Auth Token is wrong |
| A `POST` logs `200` and nothing comes back | Look for `whatsapp_send_failed` in the log. Code 63015 means that phone hasn't joined the sandbox, or its join ran out. `provider_not_configured` means `TWILIO_ACCOUNT_SID` or `TWILIO_WHATSAPP_FROM` is empty |
| Nothing is logged at all | The message went to a different number, or the sandbox URL wasn't saved |

## Not done yet

- A deployed Worker. CI checks every push, and the deploy workflow is manual until a provider's secrets exist
- A permanent access token (a System User in Meta Business Manager) to replace the 24 hour one
- Everything marked `TODO(product)`
