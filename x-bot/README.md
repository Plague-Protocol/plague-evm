# x-bot — daily draft writer for @zplaguehq

Writes one post a day about the game and sends it to you on Telegram. **It does
not post.** There is no X API client in this service and no credentials for one.
You read the draft, tap "Open in X", and publish it yourself.

That is the design, not a phase one. The account's voice is the asset, and
handing a cron job write access to it is a bad trade for saving two taps. What
automation is good at here is remembering to post every day and filling in a
real number when there is one worth using.

It is a sibling of [`support-bot/`](../support-bot), not a part of it: separate
BotFather token, separate container, separate failure domain. The support bot is
DM'd by players and backs a published 24-hour SLA, so a bad deploy of this one
must not be able to take it down.

```
09:00 UTC
    │
    ▼
pick today's angle  ──►  x_drafts (one row per date)
    │
    ▼
Telegram DM:  [ Open in X ]  [ Edit ]  [ Mark posted ]  [ Skip ]
    │
    ▼
you tap Open in X  ──►  the X composer, prefilled, on your phone
    │
    ▼
you read it and press Post
```

"Open in X" is an `x.com/intent/post` link. No API, no OAuth, no scopes, no paid
tier. The draft also arrives in a code block, which Telegram renders with
tap-to-copy on mobile, for when you would rather paste it somewhere else.

---

## What it writes

Invitations and updates, aimed at getting people to play. Four angles, rotating:

| Angle | What it does |
|---|---|
| `invite` | What the game is, and that you can play it right now |
| `mechanic` | Explains one idea: Shields, the silent vote, who holds the pot |
| `atmosphere` | Sells the feeling rather than the feature |
| `pulse` | A real number from the database, when there is a good one |

An earlier version drafted a post per settled game. That was wrong for a young
account: reporting every result daily gets tiresome fast, and it makes the
timeline a log rather than a reason to click.

**Nothing it writes says who was in the room.** No addresses, no display names,
no per-seat detail, and the `pulse` numbers are aggregate only. So no post can
claim a given game was people rather than agents, or the reverse. That
ambiguity is deliberate and there is a test that enforces it.

**Stat lines stay silent when the numbers are not flattering.** Below five games
a week, "games this week" argues against the game rather than for it, so that
template renders nothing and rotation moves past it. A quiet week still produces
a draft, just an evergreen one.

No language model. The lines are written once, by a person, in
[`src/compose.ts`](src/compose.ts). Adding one is a two-line edit to
`TEMPLATES`, and the tests will tell you if it is too long, off style, or names
a player.

### House style

Enforced in code, in [`src/style.ts`](src/style.ts), and covered by tests:

- **no emoji**
- **no dash connectors** — em dash, en dash, or a double hyphen. Hyphenated
  words like "self-play" are left alone.

The pool is already written to comply, and a test fails if a new line is not.
The guard exists for the Edit flow, so a replacement you type on your phone gets
the same treatment.

### Rotation

Least-recently-used, on the angle first and the line second. Angle first because
LRU on lines alone means a cold start opens with four invitations in a row
before the account says anything else. With 17 lines and one a day, nothing
repeats inside a fortnight, and skipped drafts count as used.

---

## Setup

Two steps, both small, because there is no X API to authorise.

### 1. Telegram bot

Talk to [@BotFather](https://t.me/BotFather), `/newbot`, take the token. **Use a
new bot, not the support bot's token.**

Message your new bot `/whoami` to get your numeric user id. That goes in
`X_OPERATOR_IDS`. Every operator must send it at least one message first, or
Telegram blocks the bot from DMing them.

### 2. Deploy

Add the variables below to `deploy/.env`, then:

```bash
cd /opt/plague && git pull && cd deploy && docker compose up -d --build x-bot
```

> ⚠ `deploy/docker-compose.yml` uses an explicit `environment:` map, not
> `env_file`. A variable added to `deploy/.env` that is not also named in the
> compose file is **silently ignored** and the container uses its code default.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `X_BOT_TELEGRAM_TOKEN` | required | BotFather token for **this** bot |
| `X_OPERATOR_IDS` | — | Comma-separated Telegram user ids that receive drafts |
| `X_DRAFT_HOUR_UTC` | `9` | UTC hour the day's draft is written |

`X_DRAFT_HOUR_UTC` only controls *when* the draft lands. One per day is
guaranteed by a date-keyed unique index, so restarting the container ten times
before noon still produces exactly one.

---

## Properties worth knowing

- **One draft per day, always.** `x_drafts.dedupe_key` is the date and it is
  unique, so a restart or two overlapping ticks cannot double up.
- **It cannot post.** Worth restating because it is a property of the code, not
  a setting: the service has no X API client, so there is no configuration
  mistake that turns this into an auto-poster.
- **It cannot affect a game.** Its only access to the game's tables is an
  aggregate `SELECT` over `GameSummary`.
- **A missed day is not backfilled.** If the container is down at 09:00 it
  drafts as soon as it comes back that day, and skips the day entirely if it
  misses it. Yesterday's post is not worth sending today.

## Operating it

- `/draft` — write today's draft now instead of waiting for the hour
- `/queue` — re-send every draft still waiting on a decision
- `/whoami` — your Telegram user id
- **Edit** puts you in edit mode for that draft: send the replacement as a
  normal message and it comes back re-checked, with the buttons again
- **Mark posted** / **Skip** drop the buttons and record the outcome, so a draft
  you have dealt with stops looking actionable, and so its line goes to the back
  of the rotation

If it goes quiet, it is almost always `X_OPERATOR_IDS` not matching your real
user id, or today's draft already existing. The container logs both.
