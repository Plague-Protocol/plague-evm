import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApprovalBot } from './telegram.js'

/**
 * Handler-order regression tests.
 *
 * `/draft` shipped dead. It was registered on the returned bot, after
 * `createApprovalBot` had already attached a `bot.on('message:text')` handler,
 * and that handler returned without calling next(). A command is a text
 * message, grammy runs middleware in registration order, so the catch-all
 * consumed `/draft` before it reached its own handler. The bot booted clean and
 * answered every other command, which is what made it hard to see.
 *
 * These drive the real middleware stack with synthetic updates, no network, so
 * a future command registered in the wrong place fails here instead of in
 * production.
 */

const OPERATOR = 42
const STRANGER = 99

/** Telegram marks commands with a bot_command entity at offset 0. */
function commandUpdate(text: string, from = OPERATOR) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      // first_name is required on a PrivateChat, not optional.
      chat: { id: from, type: 'private' as const, first_name: 'Op' },
      from: { id: from, is_bot: false, first_name: 'Op' },
      text,
      entities: [{ type: 'bot_command' as const, offset: 0, length: text.length }],
    },
  }
}

/** A bot wired to a stub API, so handlers run without touching the network. */
function harness() {
  let draftCalls = 0
  const sent: string[] = []

  const { bot } = createApprovalBot({
    token: '123456:fake',
    operatorIds: [OPERATOR],
    onDraft: async () => { draftCalls++ },
  })

  // Skip getMe. Without this, handleUpdate would try to reach Telegram.
  bot.botInfo = {
    id: 1, is_bot: true, first_name: 'Drafts', username: 'zplague_drafts_bot',
    can_join_groups: false, can_read_all_group_messages: false,
    supports_inline_queries: false,
  } as never

  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage') sent.push(String((payload as { text: string }).text))
    return { ok: true, result: true } as never
  })

  return { bot, sent, draftCalls: () => draftCalls }
}

test('/draft reaches its handler and is not eaten by the text catch-all', async () => {
  const h = harness()
  await h.bot.handleUpdate(commandUpdate('/draft'))
  assert.equal(h.draftCalls(), 1, '/draft never ran')
})

test('/whoami answers', async () => {
  const h = harness()
  await h.bot.handleUpdate(commandUpdate('/whoami'))
  assert.equal(h.sent.length, 1)
  assert.match(h.sent[0], new RegExp(String(OPERATOR)))
})

test('/start answers an operator', async () => {
  const h = harness()
  await h.bot.handleUpdate(commandUpdate('/start'))
  assert.equal(h.sent.length, 1)
})

test('a non-operator gets nothing from /draft', async () => {
  const h = harness()
  await h.bot.handleUpdate(commandUpdate('/draft', STRANGER))
  assert.equal(h.draftCalls(), 0)
  assert.equal(h.sent.length, 0)
})

test('/whoami still answers a non-operator, since that is how they find their id', async () => {
  const h = harness()
  await h.bot.handleUpdate(commandUpdate('/whoami', STRANGER))
  assert.equal(h.sent.length, 1)
})

test('plain text from an operator not editing anything is ignored quietly', async () => {
  const h = harness()
  const update = commandUpdate('just talking')
  update.message.entities = []
  await h.bot.handleUpdate(update as never)
  assert.equal(h.sent.length, 0)
  assert.equal(h.draftCalls(), 0)
})

test('a command registered after the catch-all still runs', async () => {
  // The catch-all now calls next() on every path it does not consume, so
  // registration order is no longer a trap. Without that, this is the exact
  // shape of the bug that shipped: the handler is never reached and the only
  // symptom is silence.
  const h = harness()
  let reached = false
  h.bot.command('later', () => { reached = true })

  await h.bot.handleUpdate(commandUpdate('/later'))
  assert.ok(reached, 'a command registered after message:text was swallowed')
})
