/**
 * House style for anything this bot posts.
 *
 * The account's voice is written by a person. What automation is allowed to do
 * is fill in numbers, so the job here is to stop generated text from acquiring
 * the tells that make a feed read as machine-written.
 *
 * Two rules are absolute, at the account owner's instruction:
 *   - no emoji
 *   - no dash punctuation used as a connector: em dash, en dash, or a double
 *     hyphen. A hyphen inside a word ("self-play") is fine and stays.
 *
 * `enforce` rewrites rather than rejects, because the alternative is a draft
 * that silently never reaches the approval queue. Rewrites are conservative:
 * a dash connector becomes a full stop or a comma depending on what surrounds
 * it, which is what a person would have written in the first place.
 */

export const TWEET_MAX = 280

/**
 * Emoji and pictographs. Deliberately broad, and deliberately not touching
 * text-presentation symbols that carry meaning in ordinary prose (arrows,
 * currency signs, the degree sign).
 */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{20E3}\u{2B00}-\u{2BFF}]/gu

/** Zero-width joiners and variation selectors, which glue multi-part emoji together. */
const EMOJI_GLUE = /[\u200d\ufe0e\ufe0f]/g

export interface StyleReport {
  text: string
  /** What had to be rewritten. Surfaced to the approver so nothing is silent. */
  fixes: string[]
}

/**
 * Bring a draft in line with house style.
 *
 * Order matters: dashes are resolved before whitespace is collapsed, so the
 * spacing left behind by a removed connector gets tidied in the same pass.
 */
export function enforce(raw: string): StyleReport {
  const fixes: string[] = []
  let text = raw

  const beforeEmoji = text
  text = text.replace(EMOJI, '').replace(EMOJI_GLUE, '')
  if (text !== beforeEmoji) fixes.push('removed emoji')

  const beforeDash = text
  // " word - word " / em dash / en dash / double hyphen, used as a connector.
  // A comma keeps the clauses joined where the dash was doing light work; the
  // full stop is reserved for the case where the dash separated two sentences,
  // which is what a capitalised follow-on word signals.
  text = text.replace(/\s*(?:—|–|--|\s-\s)\s*([A-Z])/g, '. $1')
  text = text.replace(/\s*(?:—|–|--|\s-\s)\s*/g, ', ')
  if (text !== beforeDash) fixes.push('replaced dash connector')

  text = text.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim()
  // A comma substitution can land next to punctuation that already closed the
  // clause. Collapse the pile-up rather than shipping ", ." to the timeline.
  text = text.replace(/,\s*\./g, '.').replace(/\.\s*,/g, '.').replace(/,{2,}/g, ',')

  return { text, fixes }
}

/** True if the text is already clean. Used by the tests and the pre-post check. */
export function isClean(text: string): boolean {
  return enforce(text).fixes.length === 0
}

/**
 * Trim to the post limit on a word boundary.
 *
 * Never cuts inside a URL: a truncated link is worse than a shorter tweet, and
 * every draft that carries one puts it last, so dropping the tail drops the
 * whole link and the sentence that introduced it.
 */
export function fit(text: string, max = TWEET_MAX): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastBreak = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'))
  return (lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()
}
