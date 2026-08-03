# Support bot

Telegram triage bot. Answers the common questions instantly, and pages a human
the moment something looks like money going missing. That escalation is what
makes the 24-hour critical-issue SLA on `/support` keepable — and MiniPay
requires a real support channel to keep a store listing.

## Setup (about 10 minutes)

1. **Create the bot.** Message [@BotFather](https://t.me/BotFather) → `/newbot`.
   Copy the token it gives you.
2. **Get your numeric user ID.** Message [@userinfobot](https://t.me/userinfobot).
   It replies with a number like `123456789` — that, not your `@handle`.
3. **Send `/start` to your new bot.** Telegram refuses to deliver a DM to anyone
   who has never opened a chat with the bot, so **skipping this silently breaks
   every alert**.
4. **Add the bot to the support *group* as an admin with every permission
   switched off.** It only reads messages and sends replies, and neither is an
   admin power — but a non-admin bot sees only messages that directly @-mention
   it ("privacy mode"), so it would miss almost everything. Admin status is
   purely the privacy-mode bypass; grant it nothing else.

   `/setprivacy` → Disable in BotFather achieves the same with less privilege,
   but it only takes effect after the bot is **removed and re-added** to the
   group, which is easy to get wrong silently. Admin has no such timing trap.

   It must be a **group**, not a channel — a channel is broadcast-only, so
   there are no member messages to triage. `@zplague_xyz` was originally the
   channel and the handle has since been moved to the supergroup, which is the
   correct target and is what `frontend/src/lib/support.ts` links to.

   Verify with `getChatMember` rather than by eye — the bot should come back
   `"status": "administrator"` with every `can_*` false. Then post a plain
   message (no slash, no @-mention) from a **non-anonymous** account and confirm
   `getUpdates` shows it with a real `from.username`. Anonymous admins arrive as
   `@GroupAnonymousBot` (id 1087968824) with `sender_chat` set, so they all
   collapse to one unusable identity and cannot be DMed back — a test sent that
   way proves nothing about ordinary users.
5. **Fill in `deploy/.env`:**
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-your-token
   SUPPORT_ALERT_USER_IDS=123456789          # comma-separated for several people
   ```
6. **Deploy:**
   ```bash
   cd /opt/plague && git pull && cd deploy
   docker compose up -d --build support-bot
   docker compose logs -f support-bot        # expect "running as @<botname>"
   ```

## What it does

| Trigger | Response |
|---|---|
| `/start`, `/help`, unrecognised message | Topic menu (six FAQ buttons + "Talk to a human") |
| Message matching an FAQ | Instant answer, plus an escape hatch to a human |
| **P0** — money missing, can't withdraw, scam, double-charged | Immediate reply, ticket logged, **DM to every operator** |
| **P1** — stuck game, errors, can't join/vote/connect | Same, one severity down |
| `/stats` *(operators)* | Open ticket counts by severity |
| `/resolve <id>` *(operators)* | Closes a ticket |

Transaction hashes and wallet addresses are pulled out of the message
automatically and included in the alert as Blockscout links, so triage does not
start with a round-trip asking for them.

## Design notes

- **Triage is biased toward false positives.** Being paged for a non-issue costs
  a glance; missing a real one costs the SLA and possibly a user's money. See
  `src/triage.ts`.
- **Long-polling, not webhooks.** No inbound port, no TLS, nothing for Caddy to
  route, and it keeps working when the public API is down.
- **Database failures are swallowed.** If Postgres is unreachable the bot still
  answers and still pages; it just logs tickets to stdout. Support must never
  depend on the ticket table.
- **Isolated from the game.** Its own container with no shared code. If it
  crashes, gameplay is unaffected.
- **FAQ copy mirrors `frontend/src/app/support/page.tsx`.** Change one, change
  the other — a bot that contradicts the site is worse than no bot. It follows
  MiniPay's copy rules too: "network fee", never "gas"; no CELO shown to MiniPay
  users.

## Testing triage without deploying

```bash
npm install && npm run build
node --input-type=module -e "
import { classify } from './dist/triage.js'
console.log(classify('someone stole my funds'))   // P0
console.log(classify('the game is stuck'))        // P1
console.log(classify('how do i play'))            // P2
"
```
