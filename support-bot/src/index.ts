/**
 * Zombie Plague support bot — @zplague_xyz
 *
 * Answers the common questions instantly and, more importantly, makes sure a
 * "my stake is gone" message reaches a human within minutes rather than
 * whenever someone next opens Telegram. That escalation is what actually backs
 * the 24-hour critical-issue SLA published on /support.
 *
 * Long-polling, not webhooks: no inbound port, no TLS, nothing for Caddy to
 * route, and it keeps working if the public API is down.
 */

import { Bot, InlineKeyboard, type Context } from 'grammy'
import { FAQ, matchFaq } from './faq.js'
import { classify, extractEvidence } from './triage.js'
import { initStore, recordTicket, resolveTicket, openCounts } from './store.js'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required. Get one from @BotFather.')
  process.exit(1)
}

/** Numeric Telegram user IDs that receive P0/P1 alerts and may run /stats. */
const ALERT_USER_IDS = (process.env.SUPPORT_ALERT_USER_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => Number.isFinite(n))

if (ALERT_USER_IDS.length === 0) {
  console.warn('[boot] SUPPORT_ALERT_USER_IDS unset — nobody will be paged for P0 issues')
}

const bot = new Bot(TOKEN)

const menu = () => {
  const kb = new InlineKeyboard()
  FAQ.forEach((e, i) => { kb.text(e.label, `faq:${e.id}`); if (i % 2 === 1) kb.row() })
  kb.row().text('🆘 Talk to a human', 'faq:human')
  return kb
}

const WELCOME =
  '*Zombie Plague support*\n\n' +
  'Pick a topic and I\'ll answer straight away. Anything urgent — money missing, ' +
  'a stuck game — gets escalated to a human automatically.\n\n' +
  'The more you include up front (wallet address, room number, transaction hash), ' +
  'the faster this goes.'

bot.command('start', ctx => ctx.reply(WELCOME, { parse_mode: 'Markdown', reply_markup: menu() }))
bot.command('help', ctx => ctx.reply(WELCOME, { parse_mode: 'Markdown', reply_markup: menu() }))

/** Operator view of the SLA. Restricted to the alert list. */
bot.command('stats', async ctx => {
  if (!ALERT_USER_IDS.includes(ctx.from?.id ?? -1)) return
  const counts = await openCounts()
  const line = Object.entries(counts).map(([s, n]) => `${s}: ${n}`).join(' · ') || 'none'
  await ctx.reply(`*Open tickets*\n${line}`, { parse_mode: 'Markdown' })
})

/** Operators close a ticket with /resolve <id>. */
bot.command('resolve', async ctx => {
  if (!ALERT_USER_IDS.includes(ctx.from?.id ?? -1)) return
  const id = Number((ctx.match as string ?? '').trim())
  if (!Number.isFinite(id)) return ctx.reply('Usage: /resolve <ticket id>')
  await ctx.reply(await resolveTicket(id) ? `Ticket #${id} closed.` : `Ticket #${id} not found or already closed.`)
})

bot.callbackQuery(/^faq:(.+)$/, async ctx => {
  const id = ctx.match[1]
  await ctx.answerCallbackQuery()
  if (id === 'human') {
    await ctx.reply(
      'Flagged for a human — someone will pick this up.\n\n' +
      'While you wait, send your *wallet address*, the *room number*, and a *transaction hash* if you have one.',
      { parse_mode: 'Markdown' },
    )
    await page(ctx, 'P1', 'user asked for a human', '(pressed “Talk to a human”)')
    return
  }
  const entry = FAQ.find(e => e.id === id)
  if (entry) await ctx.reply(entry.answer, { parse_mode: 'Markdown' })
})

bot.on('message:text', async ctx => {
  const text = ctx.message.text
  if (text.startsWith('/')) return

  const { severity, matched } = classify(text)

  // Urgent first — a P0 must never be answered with a canned FAQ reply.
  if (severity === 'P0' || severity === 'P1') {
    await ctx.reply(
      severity === 'P0'
        ? '🚨 That sounds serious and money may be involved. I have escalated it to a human right now.\n\n' +
          'Please send your *wallet address* and a *transaction hash* if you have one — it lets us trace exactly what happened.'
        : 'Flagged for a human — someone will pick this up shortly.\n\n' +
          'If you can add your *wallet address* and the *room number*, that speeds things up a lot.',
      { parse_mode: 'Markdown' },
    )
    await page(ctx, severity, matched, text)
    return
  }

  const faq = matchFaq(text)
  if (faq) {
    await ctx.reply(faq.answer, { parse_mode: 'Markdown' })
    await ctx.reply('Did that cover it? If not, tap below.', { reply_markup: new InlineKeyboard().text('🆘 Talk to a human', 'faq:human') })
    return
  }

  await ctx.reply("I'm not sure I follow — pick the closest topic, or ask for a human.",
    { reply_markup: menu() })
})

/** Record the ticket and DM every operator. */
async function page(ctx: Context, severity: string, matched: string | undefined, text: string) {
  const from = ctx.from
  const chat = ctx.chat
  if (!from || !chat || !ctx.msg) return
  const { txHash, address } = extractEvidence(text)

  const id = await recordTicket({
    telegramUserId: from.id,
    username: from.username,
    chatId: chat.id,
    messageId: ctx.msg.message_id,
    severity, matched, txHash, address, text,
  })

  const who = from.username ? `@${from.username}` : `${from.first_name ?? 'user'} (${from.id})`
  const lines = [
    `${severity === 'P0' ? '🚨 *P0*' : '⚠️ *P1*'}${id ? ` · ticket #${id}` : ''}`,
    `From: ${who}`,
    matched ? `Matched: \`${matched}\`` : undefined,
    txHash ? `Tx: https://celo.blockscout.com/tx/${txHash}` : undefined,
    address ? `Wallet: https://celo.blockscout.com/address/${address}` : undefined,
    '',
    text.slice(0, 600),
  ].filter(Boolean)

  for (const uid of ALERT_USER_IDS) {
    try {
      await bot.api.sendMessage(uid, lines.join('\n'), { parse_mode: 'Markdown' })
    } catch (err) {
      // Usually means the operator has never opened a chat with the bot.
      console.error(`[alert] could not DM ${uid}:`, err)
    }
  }
}

bot.catch(err => console.error('[bot] unhandled error:', err))

await initStore(process.env.DATABASE_URL)
console.log('[boot] support bot starting…')
await bot.start({ onStart: info => console.log(`[boot] running as @${info.username}`) })
