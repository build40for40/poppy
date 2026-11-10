# Poppy

A WhatsApp assistant that remembers you. Day 7 of [40 for 40](https://build40for40.com): 40 apps in 40 days, built live on [Twitch](https://www.twitch.tv/40for40).

This is the scaffolding. It can hold a conversation on WhatsApp and remember the person next time, and it doesn't know what it's for yet. Everything that waits on the product is marked `TODO(product)`.

## How it works

```
WhatsApp ──webhook──▶ Worker   build40for40.com/poppy/api/whatsapp
                        1. check Meta's signature on the raw body
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

The tests need no accounts and no keys. Claude and WhatsApp are both faked.

## Local sandbox: chat to it from your own phone

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

## Not done yet

- A GitHub repo, CI and a deployed Worker. Nothing here has been deployed
- A permanent access token (a System User in Meta Business Manager) to replace the 24 hour one
- Everything marked `TODO(product)`
