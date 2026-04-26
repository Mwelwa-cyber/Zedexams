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
