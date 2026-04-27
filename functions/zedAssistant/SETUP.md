# Zed Telegram assistant — setup

Founder-only Telegram bot for managing ZedExams from chat. Read-only by
default; the only Firestore write it can do is to its own task tracker.

## 1. Create the Telegram bot

1. Open Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`.
2. Pick a name and username for the bot. Save the **bot token** it returns —
   looks like `1234567890:AA...`.
3. (Optional) `/setdescription`, `/setuserpic`, `/setcommands` to polish.

## 2. Set Firebase Functions secrets

```bash
# bot token (from BotFather)
firebase functions:secrets:set TELEGRAM_BOT_TOKEN

# random secret used to verify webhook calls came from Telegram
openssl rand -hex 32   # copy the output, then:
firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET

# Anthropic key — already set if other AI features work, skip otherwise
firebase functions:secrets:set ANTHROPIC_API_KEY

# OpenAI key — required for voice messages (Whisper STT). Optional:
# without it, text still works and voice notes get a friendly fallback.
firebase functions:secrets:set OPENAI_API_KEY
```

## 3. Set the allowlist env vars

Allowlist is the Telegram **username** initially, then the numeric **chat ID**
once you have it. Chat IDs are permanent; usernames can change, so prefer the
chat ID once available.

In `functions/.env` (gitignored — create if missing):

```
ZED_TELEGRAM_ALLOWED_USERNAME=Mwelwam
# Set after step 5 below:
# ZED_TELEGRAM_ALLOWED_CHAT_ID=123456789
```

If both are set, the chat ID wins.

## 4. Deploy

PR → merge to `main`. The `deploy-firebase.yml` workflow ships the function
to `https://us-central1-examsprepzambia.cloudfunctions.net/telegramWebhook`,
also reachable at `https://zedexams.com/api/telegram/webhook` via the hosting
rewrite.

## 5. Register the webhook with Telegram

Two options.

**Option A — admin Cloud Function (recommended).** Sign in as admin in the
web app, then from the browser console:

```js
const fns = firebase.functions();
const setWebhook = fns.httpsCallable('zedSetTelegramWebhook');
await setWebhook({
  url: 'https://zedexams.com/api/telegram/webhook',
});
```

**Option B — curl.**

```bash
TOKEN=<your bot token>
SECRET=<your TELEGRAM_WEBHOOK_SECRET>
curl -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://zedexams.com/api/telegram/webhook\",
    \"secret_token\": \"${SECRET}\",
    \"allowed_updates\": [\"message\", \"edited_message\"],
    \"drop_pending_updates\": true
  }"
```

## 6. First message → capture your chat ID

Open the bot in Telegram and send `/start`.

- If your username matches `ZED_TELEGRAM_ALLOWED_USERNAME`, the bot replies
  with the help message.
- If not, the bot replies with your numeric chat ID. Copy it, set it as
  `ZED_TELEGRAM_ALLOWED_CHAT_ID` in `functions/.env`, redeploy.

You can also see the chat ID in Firebase Functions logs — look for
`zedAssistant: rejected unauthorized sender` lines.

## 7. Try it

```
What's left on games?
Summarize today's learner activity.
Draft a Claude prompt to fix the quiz editor.
Make 5 Grade 5 Maths questions on fractions.
Add a task: leaderboard tie-breaker is broken.
```

## What it can do

- **Admin summaries** — registered learners, results, scores, weak topics.
- **Task tracker** — `add_task` / `list_tasks` against `zedAssistantTasks/`.
- **Draft Codex/Claude prompts** — never edits code; produces safe prompts
  with built-in "investigate first, confirm before changing" rails.
- **Content generation** — Grade 4–6 CBC quizzes, worksheets, lesson plans
  inline in chat.
- **Firebase review** — read-only doc samples from quizzes / games / scores
  / users with PII redacted.
- **Voice in / voice out** — tap-and-hold the mic in Telegram, speak (up to
  120 seconds), Zed transcribes with Whisper, replies with both a text
  message and a real Telegram voice note synthesized by Google Cloud TTS
  (en-GB-Neural2-B by default). Set `OPENAI_API_KEY` to enable; without
  it, voice messages get a friendly text-only fallback.

## What it explicitly cannot do

- Edit source code (drafts prompts instead).
- Edit any Firestore collection except `zedAssistantTasks/`.
- Deploy, push, or run shell commands.
- Reply to anyone outside the allowlist.

## Debugging

```bash
# View Telegram's view of the webhook (URL, last error, pending count)
firebase functions:shell
> zedTelegramWebhookInfo()

# Tail logs
firebase functions:log --only telegramWebhook
```

Common failures:

- **401 from webhook**: `TELEGRAM_WEBHOOK_SECRET` mismatch between the
  Functions secret and the value passed to `setWebhook`.
- **"not_configured"**: a secret isn't deployed. Check the function's
  Secret Manager bindings in the GCP console.
- **No reply, no error**: sender isn't on the allowlist — bot silently
  responds with the chat-ID hint then returns.

## Rotating the bot token

If the token leaks, message @BotFather → `/revoke` → `/token`. Re-run
`firebase functions:secrets:set TELEGRAM_BOT_TOKEN` with the new value and
redeploy. The webhook stays valid; only the token changes.

---

# WhatsApp setup

Same agent, second messaging channel. Founder-only via phone-number
allowlist. Text + voice (Whisper STT + Google TTS) work the same as
Telegram. Conversation memory is partitioned at
`zedAssistantChats/wa:{phone}/turns`.

## 1. Create a Meta WhatsApp Business app

1. Go to [developers.facebook.com](https://developers.facebook.com/apps/) →
   **Create App** → **Business** → **Next**.
2. Add the **WhatsApp** product.
3. Under WhatsApp → API Setup, copy:
   - **Phone number ID** (numeric)
   - **Temporary access token** (24-hour, fine for first test) OR generate
     a long-lived **System User token** under Business Settings → Users →
     System Users (recommended for production).
4. Add a recipient phone number under the same panel and verify it via
   the OTP — that's the founder's phone for testing.

## 2. Set Firebase Functions secrets

```bash
# Long-lived System User access token (or 24h temp token to start)
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN

# The numeric phone-number-id from the API Setup panel
firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID

# Random secret used to verify Meta's webhook handshake
openssl rand -hex 32   # copy the output, then:
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN
```

`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` already exist from Telegram —
nothing else to set.

## 3. Set the allowlist env var

In `functions/.env` (gitignored):

```
# Comma-separated E.164 numbers without leading +. Empty = no one allowed.
ZED_WHATSAPP_ALLOWED_NUMBERS=260971234567
```

You can list multiple numbers if needed (e.g. a backup phone).

## 4. Deploy

```bash
firebase deploy --only functions:whatsappWebhook,hosting
```

The function ships to
`https://us-central1-examsprepzambia.cloudfunctions.net/whatsappWebhook`,
also reachable at `https://zedexams.com/api/whatsapp/webhook` via the
hosting rewrite.

## 5. Register the webhook with Meta

In the Meta app dashboard → WhatsApp → Configuration → Webhook:

- **Callback URL**: `https://zedexams.com/api/whatsapp/webhook`
- **Verify token**: paste the value of `WHATSAPP_VERIFY_TOKEN`
- Click **Verify and save** — Meta sends a GET request; the function
  echoes back `hub.challenge` if the verify token matches.
- Subscribe to webhook fields: at minimum **`messages`**.

## 6. Try it

From the verified WhatsApp recipient phone, send the bot a message:

```
What's left on games?
```

Or hold the mic to send a voice note. Replies come back as text + voice
note (same pattern as Telegram).

Commands:

- `/start` or `/help` — usage hints
- `/voice` — list / pick voice
- `/voice 3` — switch voice for this chat
- `/reset` — wipe my memory of this chat

## 7. Going to production

The "From" phone number you tested with is a Meta-issued sandbox number.
For real use, register your own business phone number in the WhatsApp
Manager — that adds a per-message cost (very small, free tier covers
1,000 service conversations/month) and requires Meta Business
verification. Until then, only verified test recipients can message the
bot.

## Debugging

```bash
# Tail logs
firebase functions:log --only whatsappWebhook
```

Common failures:

- **403 on the verify request from Meta**: `WHATSAPP_VERIFY_TOKEN`
  mismatch. Re-set it as a secret, redeploy, and retry "Verify and save".
- **"not_configured"**: a secret isn't deployed. Check Secret Manager.
- **Bot sends nothing**: sender isn't on `ZED_WHATSAPP_ALLOWED_NUMBERS`.
- **24-hour window error** when initiating outbound message: the user
  hasn't messaged the bot in the last 24h. For founder-only use this
  almost never happens (you're the one initiating); if it does, the user
  just sends one message first.

