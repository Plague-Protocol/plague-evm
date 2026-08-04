/**
 * Zombie Plague draft writer.
 *
 * Once a day it writes a post about the game and sends it to the operators on
 * Telegram. It does not post. There is no X API client in this service and no
 * credentials for one: publishing is a human action, every time.
 *
 * Once a day, not once a game. Reporting every settled result is a log, not a
 * reason to follow an account, and it goes stale in about a week. These are
 * invitations and updates, and none of them says who was in the room.
 *
 * Its @username is whatever BotFather issued and is deliberately not written
 * down here. It is NOT the support bot: see the note at the top of telegram.ts.
 *
 * Long-polling on the Telegram side, so there is no inbound port, nothing for
 * Caddy to route, and it keeps working when the public API is down.
 */

import { initStore, enqueue, recentTemplateIds } from './store.js'
import { readPulse } from './stats.js'
import { draftForToday } from './compose.js'
import { createApprovalBot } from './telegram.js'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}

const TELEGRAM_TOKEN = process.env.X_BOT_TELEGRAM_TOKEN
if (!TELEGRAM_TOKEN) {
  console.error('X_BOT_TELEGRAM_TOKEN is required. Get one from @BotFather (a separate bot from the support bot).')
  process.exit(1)
}

const OPERATOR_IDS = (process.env.X_OPERATOR_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite)

if (OPERATOR_IDS.length === 0) {
  console.warn('[boot] X_OPERATOR_IDS unset. Drafts will queue with nobody receiving them.')
}

/** UTC hour the day's draft is written. Default 09:00 UTC, mid-morning in most of Europe and Africa. */
const DRAFT_HOUR_UTC = Number(process.env.X_DRAFT_HOUR_UTC ?? 9)

// Checked often, acted on once. The date-keyed dedupe is what makes it exactly
// one draft per day, so the interval only controls how soon after the hour it
// lands and how quickly it recovers from a restart.
const CHECK_MS = 15 * 60_000

async function main() {
  await initStore(DATABASE_URL!)

  const { bot, notify } = createApprovalBot({
    token: TELEGRAM_TOKEN!,
    operatorIds: OPERATOR_IDS,
  })

  async function tick(force = false) {
    try {
      const now = new Date()
      if (!force && now.getUTCHours() < DRAFT_HOUR_UTC) return

      const [pulse, recent] = await Promise.all([readPulse(), recentTemplateIds()])
      const draft = draftForToday(pulse, recent, now)
      if (!draft) {
        console.log('[draft] no template had anything to say today')
        return
      }

      const row = await enqueue(draft.kind, draft.templateId, draft.dedupeKey, draft.text)
      if (!row) return // today's draft already exists
      console.log(`[draft] wrote ${row.id} (${draft.kind}/${draft.templateId})`)
      await notify(row, draft.fixes)
    } catch (err) {
      console.error('[draft] tick failed:', err)
    }
  }

  // `/draft` forces one, for when you want something to post now rather than
  // waiting for tomorrow. Still bound by the one-per-day key.
  bot.command('draft', async ctx => {
    if (!OPERATOR_IDS.includes(ctx.from?.id ?? -1)) return
    await ctx.reply('Writing one now.')
    await tick(true)
  })

  setInterval(() => { void tick() }, CHECK_MS)
  void tick()

  bot.start({
    onStart: info => console.log(
      `[boot] @${info.username} up. operators=${OPERATOR_IDS.length} draftHourUTC=${DRAFT_HOUR_UTC}. One draft a day, nothing is posted.`,
    ),
  })
}

void main().catch(err => {
  console.error('[boot] fatal:', err)
  process.exit(1)
})
