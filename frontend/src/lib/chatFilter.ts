/**
 * Room-chat content guard, client side.
 *
 * A verbatim mirror of `backend/src/lib/chatFilter.ts`, which is the
 * authoritative copy: the server re-runs every one of these rules on
 * `chat_message`, because a client can emit that event without ever touching
 * this input box. This copy exists only so the sender is told immediately
 * rather than after a socket round trip.
 *
 * If you change a rule, change it in both files. There is no shared package
 * between `frontend/` and `backend/` to hang it off, and standing one up for a
 * single pure function was not worth the build wiring.
 */

export const CHAT_MAX_LENGTH = 256

export type ChatCheck =
  | { ok: true; text: string }
  | { ok: false; reason: string }

/** What the sender is told. Deliberately not a lecture about XSS. */
const CODE_REASON = 'That looks like code. Room chat is for talking to the other players.'
const MARKUP_REASON = 'HTML and script tags are not allowed in chat.'
const EMPTY_REASON = 'Nothing to send.'

/**
 * Patterns that never show up in a sentence a player would type, so any single
 * hit is enough to reject. Each is paired with the message the sender sees.
 */
const HARD_RULES: Array<{ pattern: RegExp; reason: string }> = [
  // Any HTML/XML-ish tag: <script>, </div>, <img src=x onerror=…>.
  { pattern: /<\s*\/?\s*[a-z][a-z0-9-]*(\s[^>]*)?>/i, reason: MARKUP_REASON },
  // Script-bearing URI schemes, including the `data:` HTML trick.
  { pattern: /\b(?:javascript|vbscript)\s*:/i, reason: MARKUP_REASON },
  { pattern: /\bdata\s*:\s*text\/html/i, reason: MARKUP_REASON },
  // Inline event handlers, the payload half of most paste-in attacks.
  { pattern: /\bon(?:click|error|load|mouseover|focus|blur|submit|change)\s*=/i, reason: MARKUP_REASON },
  // Host objects. `console.log(` from the reviewer's paste lands here.
  { pattern: /\b(?:console|document|window|globalThis|navigator|location|localStorage|sessionStorage)\s*\./i, reason: CODE_REASON },
  // Calls that only exist in code. Note `\(` is required, so a player saying
  // "i want to alert everyone" is fine and "alert(" is not.
  { pattern: /\b(?:eval|atob|btoa|fetch|alert|prompt|confirm|require|setTimeout|setInterval|XMLHttpRequest|Function)\s*\(/i, reason: CODE_REASON },
  // Declarations. The `\s+ident` shape matters: a bare /\blet\b/ would reject
  // "let's be systematic", which is exactly how people talk in this game.
  { pattern: /\b(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=/, reason: CODE_REASON },
  { pattern: /\bfunction\s*[A-Za-z_$][\w$]*\s*\(|\bfunction\s*\(/, reason: CODE_REASON },
  { pattern: /\bclass\s+[A-Za-z_$][\w$]*\s*(?:extends\s+[\w$.]+\s*)?\{/, reason: CODE_REASON },
  // Template literals and module syntax.
  { pattern: /\$\{[^}]*\}/, reason: CODE_REASON },
  { pattern: /\bimport\s+[^;]*\bfrom\s*['"]|\brequire\s*\(\s*['"]/, reason: CODE_REASON },
  { pattern: /\bexport\s+(?:default|const|function|class)\b/, reason: CODE_REASON },
  // Other languages people reach for when probing an input box.
  { pattern: /<\?php|#!\s*\/(?:bin|usr)\//i, reason: CODE_REASON },
]

/**
 * Weaker tells. Any one of these alone is something a player might plausibly
 * type; two together is a code paste. Two is the threshold because the
 * reviewer's snippet trips four, while the chattiest real messages trip none.
 */
const SOFT_RULES: RegExp[] = [
  /\{[^}]*\}/,                                 // a brace block
  /;[^;]*;/,                                   // two or more statement terminators
  /(?:^|\s)\/\/\s|\/\*[\s\S]*?\*\//,           // line or block comment
  /[A-Za-z_$][\w$]*\s*\([^)]*\)\s*[;{]/,       // a call or signature that closes into code
  /[A-Za-z_$][\w$]*\s*=\s*(?:['"`[{]|\d)/,     // assignment to a literal
  /[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\s*\(/,   // member call, obj.method(
  // Arrow. Soft rather than hard because players do type "Player 3 => sus" as
  // shorthand; every real arrow function also trips a declaration rule above.
  /=>/,
]

const SOFT_THRESHOLD = 2

/**
 * Flatten to a single line of printable text.
 *
 * Collapsing every whitespace run also destroys the indentation and line breaks
 * a pasted snippet relies on, so even a message that slips past the rules below
 * cannot render as a code block in the transcript.
 */
function normalise(raw: string): string {
  return String(raw)
    // Stripping control characters is the point here, hence the rule waiver.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')      // control characters
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '')  // zero-width, separators
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX_LENGTH)
    .trim()
}

/** Shared normalise-then-classify pass. `softThreshold` is how many weak tells it takes to reject. */
function screen(raw: unknown, softThreshold: number): ChatCheck {
  if (typeof raw !== 'string') return { ok: false, reason: EMPTY_REASON }

  const text = normalise(raw)
  if (!text) return { ok: false, reason: EMPTY_REASON }

  for (const rule of HARD_RULES) {
    if (rule.pattern.test(text)) return { ok: false, reason: rule.reason }
  }

  let hits = 0
  for (const rule of SOFT_RULES) {
    if (rule.test(text)) hits++
    if (hits >= softThreshold) return { ok: false, reason: CODE_REASON }
  }

  return { ok: true, text }
}

/**
 * Normalise a chat message and decide whether it is talk or code.
 *
 * Returns the cleaned text to broadcast on success, or the reason to show the
 * sender on rejection. Callers must relay the returned `text`, not the input
 * they passed in.
 */
export function checkChatMessage(raw: unknown): ChatCheck {
  return screen(raw, SOFT_THRESHOLD)
}

/**
 * Display-name guard, sharing the chat rules but stricter about the soft ones.
 *
 * Nicknames are the wider surface of the two: they persist, and they render on
 * the leaderboard and every player card rather than scrolling out of one room's
 * transcript. A single soft signal is enough to reject, because unlike a chat
 * line there is no sentence a name is trying to be. Applied on write only, so
 * names already in the table keep working.
 */
export function isSafeDisplayName(raw: string): boolean {
  return screen(raw, 1).ok
}
