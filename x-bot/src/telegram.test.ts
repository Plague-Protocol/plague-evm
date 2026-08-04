import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeCodeBlock, escapeMd, intentUrl } from './telegram.js'
import { ALL_TEMPLATES, draftForToday } from './compose.js'
import type { Pulse } from './stats.js'

/** Every character Telegram treats as special in MarkdownV2 body text. */
const MD_SPECIALS = '_*[]()~`>#+-=|{}.!\\'

const busy: Pulse = {
  gamesThisWeek: 14,
  biggestPotWei: '24000000000000000000',
  totalStakedWei: '180000000000000000000',
  longestRounds: 5,
  gamesAllTime: 130,
}

test('escapeMd escapes every MarkdownV2 special character', () => {
  const out = escapeMd(MD_SPECIALS)
  for (const ch of MD_SPECIALS) {
    assert.ok(out.includes('\\' + ch), `${ch} was not escaped`)
  }
})

test('escapeMd handles the characters that actually appear in a header', () => {
  // An unescaped special here is a 400 from Telegram and a draft that never
  // arrives, which is the failure this guards.
  assert.equal(escapeMd('(mechanic, 214/280)'), '\\(mechanic, 214/280\\)')
  // No current kind slug has an underscore, but one added later might, and an
  // underscore is the easiest MarkdownV2 special to introduce by accident.
  assert.equal(escapeMd('some_new_kind'), 'some\\_new\\_kind')
})

test('escapeMd leaves ordinary prose alone', () => {
  assert.equal(escapeMd('They found Patient Zero'), 'They found Patient Zero')
})

test('code block escaping touches only backslash and backtick', () => {
  // Anything more would put literal backslashes into text meant to be copied
  // straight onto the timeline.
  assert.equal(escapeCodeBlock('a.b-c!d (e)'), 'a.b-c!d (e)')
  assert.equal(escapeCodeBlock('a`b'), 'a\\`b')
  assert.equal(escapeCodeBlock('a\\b'), 'a\\\\b')
})

test('intent link round-trips the draft text exactly', () => {
  const draft = draftForToday(busy, [])!
  const url = new URL(intentUrl(draft.text))
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post')
  assert.equal(url.searchParams.get('text'), draft.text)
})

test('intent link encodes characters that would break the query string', () => {
  const url = new URL(intentUrl('a&b=c #tag'))
  assert.equal(url.searchParams.get('text'), 'a&b=c #tag')
})

test('every template survives both the intent link and the copy block', () => {
  for (const t of ALL_TEMPLATES) {
    const text = t.render(busy)
    if (text === null) continue
    assert.equal(new URL(intentUrl(text)).searchParams.get('text'), text, t.id)
    // Nothing in the pool should need code-fence escaping; if one does, the
    // copy block would show a stray backslash to be pasted onto the timeline.
    assert.equal(escapeCodeBlock(text), text, `${t.id} needs escaping in the copy block`)
  }
})
