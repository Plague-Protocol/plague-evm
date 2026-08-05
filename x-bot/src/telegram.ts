/**
 * Delivery and editing surface for drafts.
 *
 * Nothing here posts anything. The bot writes the text, hands it to you, and
 * you decide whether it goes out. That was a deliberate call: the account's
 * voice is the asset, and a cron job with write access to it is a bad trade for
 * saving two taps.
 *
 * Two ways to take a draft out of here, both manual:
 *   - the "Open in X" button, an x.com/intent/post link that opens the composer
 *     with the text already in it. You still see it and still press Post.
 *   - the code block underneath, which Telegram renders with tap-to-copy on
 *     mobile, for when you would rather paste it somewhere else first.
 *
 * Its own BotFather token, deliberately not the support bot's. That bot is DM'd
 * by players and backs a published 24-hour SLA; this one should be findable
 * only by whoever runs the account, and a bad deploy of one must not take out
 * the other. The operator allowlist is the actual access control either way,
 * since anyone can find any bot by username.
 */

import { Bot, InlineKeyboard } from 'grammy'
import { getDraft, pendingDrafts, setStatus, updateBody, type DraftRow } from './store.js'
import { enforce, fit } from './style.js'

export interface TelegramConfig {
  token: string
  operatorIds: number[]
  /**
   * Write today's draft now, for `/draft`.
   *
   * Passed in rather than registered by the caller after this returns. Command
   * handlers must be registered before the `message:text` catch-all at the
   * bottom of this file: a command IS a text message, grammy runs middleware in
   * registration order, and that handler returns without calling next() when it
   * has nothing to do. Anything registered later never runs.
   */
  onDraft: () => Promise<void>
}

/** Draft id an operator is currently retyping, keyed by their Telegram user id. */
const editing = new Map<number, number>()

/** Opens the X composer with the text prefilled. No API, no credentials, no scopes. */
export function intentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`
}

/**
 * Escape for the inside of a MarkdownV2 code fence.
 *
 * Narrow on purpose: inside a fence only the backslash and the backtick still
 * need escaping, and escaping the full set here would put literal backslashes
 * into the text you are about to copy onto the timeline.
 */
export function escapeCodeBlock(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`')
}

/**
 * Escape for ordinary MarkdownV2 text.
 *
 * Telegram rejects the whole message with a 400 on a single unescaped special
 * character, so one bad draft header takes out delivery of that draft entirely
 * and the only trace is a log line. The current kind slugs happen to be clean
 * words, but the header also carries the length as `214/280` and wraps it in
 * parentheses, both of which need escaping, and a slug added later may not be
 * clean. Nothing interpolated here is safe raw.
 */
export function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, m => '\\' + m)
}

/** Human label for a draft kind. Underscores are stripped because they are MarkdownV2 specials. */
function kindLabel(kind: string): string {
  return kind.replace(/_/g, ' ')
}

export function createApprovalBot(cfg: TelegramConfig) {
  const bot = new Bot(cfg.token)
  const isOperator = (id?: number) => id !== undefined && cfg.operatorIds.includes(id)

  const keyboard = (d: DraftRow) =>
    new InlineKeyboard()
      .url('Open in X', intentUrl(d.text)).row()
      .text('Edit', `edit:${d.id}`)
      .text('Mark posted', `done:${d.id}`)
      .text('Skip', `skip:${d.id}`)

  const render = (d: DraftRow, fixes: string[]) => {
    const lines = [
      `*Draft ${d.id}* ${escapeMd(`(${kindLabel(d.kind)}, ${d.text.length}/280)`)}`,
      '',
      '```',
      escapeCodeBlock(d.text),
      '```',
    ]
    if (fixes.length > 0) {
      lines.push('', `_${escapeMd(`House style applied: ${fixes.join(', ')}`)}_`)
    }
    return lines.join('\n')
  }

  const send = (chatId: number, d: DraftRow, fixes: string[]) =>
    bot.api.sendMessage(chatId, render(d, fixes), {
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard(d),
      link_preview_options: { is_disabled: true },
    })

  /** Push a queued draft to every operator. */
  async function notify(draft: DraftRow, fixes: string[]): Promise<void> {
    for (const uid of cfg.operatorIds) {
      try {
        await send(uid, draft, fixes)
      } catch (err) {
        // An operator who has never messaged the bot cannot be DM'd by it.
        console.error(`[telegram] could not reach operator ${uid}:`, err)
      }
    }
  }

  bot.command('start', ctx => {
    if (!isOperator(ctx.from?.id)) return
    return ctx.reply(
      'Zombie Plague draft writer. When a game settles I will write a post about it and send it here.\n\n'
      + 'Nothing is ever posted automatically. Open in X puts the text in the composer for you, '
      + 'or tap the code block to copy it.\n\n'
      + `Your Telegram user id is ${ctx.from?.id}, which is what belongs in X_OPERATOR_IDS.`,
    )
  })

  // Deliberately answers non-operators too, and only with their own user id.
  // Finding the id is the first setup step and there is nothing sensitive in it.
  bot.command('whoami', ctx => ctx.reply(`Your Telegram user id is ${ctx.from?.id}`))

  bot.command('queue', async ctx => {
    if (!isOperator(ctx.from?.id)) return
    const rows = await pendingDrafts()
    if (rows.length === 0) return ctx.reply('Nothing waiting.')
    for (const d of rows) await send(ctx.chat.id, d, [])
  })

  bot.command('draft', async ctx => {
    if (!isOperator(ctx.from?.id)) return
    await ctx.reply('Writing one now.')
    await cfg.onDraft()
  })

  bot.callbackQuery(/^(edit|done|skip):(\d+)$/, async ctx => {
    const uid = ctx.from.id
    if (!isOperator(uid)) return ctx.answerCallbackQuery({ text: 'Not authorised.' })

    const [, action, rawId] = ctx.match as RegExpMatchArray
    const id = Number(rawId)
    const draft = await getDraft(id)
    if (!draft) return ctx.answerCallbackQuery({ text: 'That draft is gone.' })

    if (action === 'edit') {
      editing.set(uid, id)
      await ctx.answerCallbackQuery({ text: 'Send the replacement text.' })
      return ctx.reply(`Send the new text for draft ${id}. It will be re-checked against house style.`)
    }

    const status = action === 'done' ? 'posted' : 'skipped'
    await setStatus(id, status, uid)
    await ctx.answerCallbackQuery({ text: status === 'posted' ? 'Marked as posted.' : 'Skipped.' })
    // Drop the buttons so a used draft stops looking actionable. The text stays
    // in the thread as the record of what was written.
    return ctx.editMessageReplyMarkup({ reply_markup: undefined })
  })

  // Free text is only ever a replacement for a draft being edited.
  //
  // Calls next() on every path it does not consume. This handler matches ALL
  // text, commands included, so swallowing what it cannot use makes every
  // command registered after it silently dead. That is exactly what happened to
  // /draft, which returned nothing at all until it moved above this line.
  bot.on('message:text', async (ctx, next) => {
    const uid = ctx.from?.id
    if (!isOperator(uid) || uid === undefined) return next()
    const id = editing.get(uid)
    if (id === undefined) return next()

    const { text, fixes } = enforce(ctx.message.text)
    await updateBody(id, fit(text))
    editing.delete(uid)

    const updated = await getDraft(id)
    if (!updated) return ctx.reply('That draft is gone.')
    return send(ctx.chat.id, updated, fixes)
  })

  bot.catch(err => console.error('[telegram] handler error:', err))

  return { bot, notify }
}
