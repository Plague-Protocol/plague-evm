import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enforce, fit, isClean, TWEET_MAX } from './style.js'
import { ALL_TEMPLATES, draftForToday, formatToken } from './compose.js'
import type { Pulse } from './stats.js'

/** A healthy week, so every stat-backed line has something true to say. */
const busy: Pulse = {
  gamesThisWeek: 14,
  biggestPotWei: '24000000000000000000',
  totalStakedWei: '180000000000000000000',
  longestRounds: 5,
  gamesAllTime: 130,
}

/** A brand new account with nothing to boast about yet. */
const quiet: Pulse = {
  gamesThisWeek: 1,
  biggestPotWei: '0',
  totalStakedWei: '0',
  longestRounds: 2,
  gamesAllTime: 3,
}

// ── House style ───────────────────────────────────────────────────────────────

test('strips emoji', () => {
  const { text, fixes } = enforce('They found Patient Zero 🧟 and took the pot 🏆')
  assert.equal(text, 'They found Patient Zero and took the pot')
  assert.deepEqual(fixes, ['removed emoji'])
})

test('replaces an em dash between clauses with a comma', () => {
  assert.equal(enforce('Nobody won — the round limit hit first').text, 'Nobody won, the round limit hit first')
})

test('replaces a dash before a capitalised clause with a full stop', () => {
  assert.equal(enforce('Three rounds — Patient Zero walked').text, 'Three rounds. Patient Zero walked')
})

test('handles en dash and double hyphen the same way', () => {
  assert.equal(enforce('a – b').text, 'a, b')
  assert.equal(enforce('a -- b').text, 'a, b')
  assert.equal(enforce('a - b').text, 'a, b')
})

test('leaves hyphenated words alone', () => {
  assert.equal(enforce('Agent self-play ran overnight.').text, 'Agent self-play ran overnight.')
  assert.ok(isClean('Agent self-play ran overnight.'))
})

test('does not leave stray punctuation behind a substitution', () => {
  const { text } = enforce('Caught in 3 rounds — . The pot settled.')
  assert.ok(!text.includes(', .'), text)
  assert.ok(!text.includes('..'), text)
})

test('fit trims on a word boundary and never mid-word', () => {
  const out = fit('word '.repeat(80))
  assert.ok(out.length <= TWEET_MAX)
  assert.ok(!out.endsWith('wor'))
})

test('fit leaves short text untouched', () => {
  assert.equal(fit('short'), 'short')
})

test('formatToken renders whole and fractional stakes', () => {
  assert.equal(formatToken('18000000000000000000'), '18')
  assert.equal(formatToken('1500000000000000000'), '1.5')
  assert.equal(formatToken('0'), '0')
  assert.equal(formatToken('not-a-number'), '0')
})

// ── The pool ──────────────────────────────────────────────────────────────────

test('every template is postable as written, with no style fixes needed', () => {
  // A fix firing here means a line was written badly rather than that the guard
  // is working. The guard is the net for hand-typed edits, not for this file.
  for (const t of ALL_TEMPLATES) {
    const text = t.render(busy)
    if (text === null) continue
    assert.ok(text.length <= TWEET_MAX, `${t.id} is ${text.length} chars: ${text}`)
    assert.ok(isClean(text), `${t.id} needs a style fix: ${text}`)
    assert.ok(text.includes('zplague.xyz'), `${t.id} has no link`)
  }
})

test('no template names a player, a wallet or who was in the room', () => {
  // The account posts about the game, never about a roster. This is what keeps
  // any given post honest without needing to know who actually played.
  for (const t of ALL_TEMPLATES) {
    const text = t.render(busy)
    if (text === null) continue
    assert.ok(!/0x[0-9a-f]/i.test(text), `${t.id} contains an address`)
    assert.ok(!/\bbots? (?:play|beat|won|versus|vs)\b/i.test(text), `${t.id} claims who played: ${text}`)
    assert.ok(!/\bagents? (?:play|beat|won|versus|vs)\b/i.test(text), `${t.id} claims who played: ${text}`)
  }
})

test('template ids are unique', () => {
  const ids = ALL_TEMPLATES.map(t => t.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('the pool is deep enough that nothing repeats within a fortnight', () => {
  assert.ok(ALL_TEMPLATES.length >= 14, `only ${ALL_TEMPLATES.length} templates`)
})

// ── Selection ─────────────────────────────────────────────────────────────────

test('stat lines stay silent when the numbers are not worth posting', () => {
  // A young account should never be made to argue against itself with "1 game
  // this week". Those templates render null and rotation moves past them.
  const silent = ALL_TEMPLATES.filter(t => t.kind === 'pulse' && t.render(quiet) === null)
  assert.equal(silent.length, ALL_TEMPLATES.filter(t => t.kind === 'pulse').length)
})

test('a quiet week still produces a draft', () => {
  const d = draftForToday(quiet, [])
  assert.ok(d, 'expected an evergreen line to carry the day')
  assert.notEqual(d.kind, 'pulse')
})

test('rotation does not repeat a line that was just used', () => {
  const used: string[] = []
  for (let day = 0; day < 12; day++) {
    const d = draftForToday(busy, used, new Date(Date.UTC(2026, 7, day + 1)))
    assert.ok(d)
    assert.ok(!used.includes(d.templateId), `${d.templateId} repeated on day ${day}`)
    used.push(d.templateId)
  }
})

test('rotation interleaves angles rather than marching through one kind', () => {
  const used: string[] = []
  const kinds: string[] = []
  for (let day = 0; day < 6; day++) {
    const d = draftForToday(busy, used, new Date(Date.UTC(2026, 7, day + 1)))!
    used.push(d.templateId)
    kinds.push(d.kind)
  }
  assert.ok(new Set(kinds).size >= 3, `only saw ${[...new Set(kinds)].join(', ')}`)
})

test('one draft per day, keyed by date', () => {
  const day = new Date(Date.UTC(2026, 7, 4))
  assert.equal(draftForToday(busy, [], day)!.dedupeKey, 'daily:2026-08-04')
  // Same day, same key, so the unique index rejects the second insert.
  assert.equal(draftForToday(busy, [], day)!.dedupeKey, draftForToday(busy, [], day)!.dedupeKey)
})

test('every draft it can produce is within the post limit', () => {
  const used: string[] = []
  for (let day = 0; day < ALL_TEMPLATES.length; day++) {
    const d = draftForToday(busy, used, new Date(Date.UTC(2026, 7, day + 1)))!
    assert.ok(d.text.length <= TWEET_MAX, `${d.templateId}: ${d.text.length}`)
    used.push(d.templateId)
  }
})
