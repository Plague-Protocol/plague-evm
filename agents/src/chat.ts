/**
 * chat.ts — persona-driven, state-aware bot chat.
 *
 * Each bot index maps to a stable persona (recognizable across games — the
 * same on-chain agent always "sounds" the same). Lines are picked from
 * context-weighted pools with template slots filled from PUBLIC game state:
 *
 *   {t} — an alive player being accused        {s} — the last chat speaker
 *   {e} — a player eliminated last round       {n} — current round number
 *
 * Fair information model (same as the voting AI in runner.ts): a bot only
 * ever uses its OWN role. Infected bots deflect; clean bots push for
 * shields. No line ever states or implies another player's role.
 */

export interface ChatContext {
  round: number
  /** Display names of alive players, excluding the speaking bot. */
  aliveNames: string[]
  /** Names eliminated since the bot last spoke (mourn/react targets). */
  freshlyEliminated: string[]
  /** Bot's own role — the only private input allowed. */
  ownInfected: boolean
  /** Last chat heard from someone else within the reply window, if any. */
  lastHeard: { name: string; at: number } | null
  /** True if someone said this bot's name recently (triggers defense). */
  mentioned: boolean
}

interface Persona {
  name: string
  openers: string[]
  accuse: string[]   // {t}
  reply: string[]    // {s}
  defend: string[]
  mourn: string[]    // {e}
  preVote: string[]  // {n}
  deflect: string[]  // infected only — subtle misdirection
  push: string[]     // clean only — pro-shield, pro-scrutiny
}

const PERSONAS: Persona[] = [
  {
    // Bot 1 — "the analyst": methodical, measured, a little smug.
    name: 'analyst',
    openers: [
      'let\'s be systematic. who shielded last round, who didn\'t?',
      'the data doesn\'t lie. the chat does.',
      'every round the pattern gets clearer. keep talking.',
      'observing. carry on.',
    ],
    accuse: [
      '{t}\'s voting pattern doesn\'t add up. look closer.',
      'statistically, {t} is due for a shield. why haven\'t they?',
      'i\'ve been tracking {t}. something\'s off.',
      '{t} talks a lot for someone with nothing to prove.',
    ],
    reply: [
      'noted, {s}. filing that under "suspicious".',
      'interesting theory, {s}. show me evidence.',
      '{s} makes a fair point. doesn\'t clear them though.',
    ],
    defend: [
      'accusing me? my record is clean and on-chain. check it.',
      'wrong tree. redo your analysis.',
      'i\'d shield right now if it weren\'t a waste of a proof.',
    ],
    mourn: [
      '{e} is gone. update your models accordingly.',
      'losing {e} tells us something. think about who pushed that vote.',
    ],
    preVote: [
      'round {n} vote incoming. choose with your head, not the chat.',
      'votes are data too. i\'ll be watching who votes where.',
    ],
    deflect: [
      'the loudest accusers are usually hiding something.',
      'i\'d look at whoever changes their story between rounds.',
    ],
    push: [
      'clean players: shield up. it\'s the only signal that matters.',
      'anyone refusing to shield is choosing to look guilty.',
    ],
  },
  {
    // Bot 2 — "the paranoid": anxious, jumpy, trusts nobody.
    name: 'paranoid',
    openers: [
      'i don\'t like this. i don\'t like ANY of this.',
      'someone in here is lying and it\'s making my skin crawl.',
      'i counted the players twice. one of you is IT.',
      'can\'t sleep. the plague never sleeps either.',
    ],
    accuse: [
      'did anyone else see how fast {t} voted last round?? no? just me??',
      '{t} is too calm. NOBODY should be that calm.',
      'i had a bad dream about {t}. that counts for something.',
      'why is {t} always typing then deleting? WHAT ARE YOU DELETING {t}?',
    ],
    reply: [
      'that\'s EXACTLY what an infected would say, {s}.',
      '{s} i want to believe you. i really do. but no.',
      'ok {s} but consider: what if you\'re wrong and we all die?',
    ],
    defend: [
      'ME?? i\'ve been sounding the alarm since round one!!',
      'this is a setup. the real carrier is framing me. classic.',
      'test me. shield me. swab me. i\'ll do ANYTHING.',
    ],
    mourn: [
      'they got {e}. WHO\'S NEXT? it could be me. it\'s probably me.',
      '{e} was the only one i almost trusted. almost.',
    ],
    preVote: [
      'round {n} and i still trust exactly zero of you.',
      'voting time. my hands are shaking. don\'t waste this.',
    ],
    deflect: [
      'i\'m too scared to be the carrier. carriers are CALM.',
      'check the quiet ones. the quiet ones always turn.',
    ],
    push: [
      'SHIELD. UP. all of you. right now. please.',
      'if you\'re clean, prove it. if you can\'t, i\'m coming for you.',
    ],
  },
  {
    // Bot 3 — "gallows humor": jokes about the doom.
    name: 'gallows',
    openers: [
      'day 4 of the outbreak: chat still funnier than it is useful.',
      'love what the plague has done with the place.',
      'reminder that the pot splits better with fewer of you. kidding. mostly.',
      'anyone else here just for the ambience?',
    ],
    accuse: [
      '{t} has strong "it was me all along" energy today.',
      'plot twist: it\'s {t}. it\'s always the one you least suspect. or most. one of those.',
      'i\'d bet half the pot on {t} and the other half on being wrong.',
      'if {t} turns out clean i\'ll eat my hazmat suit.',
    ],
    reply: [
      '{s} said it, not me. i just think it\'s funny.',
      'bold words {s}. hope they age well.',
      'writing that down, {s}. for the memorial service.',
    ],
    defend: [
      'me, infected? i can\'t even commit to a bit that long.',
      'if i were the carrier this chat would be way more organized.',
      'accuse me again and i\'m haunting this room after elimination.',
    ],
    mourn: [
      'rip {e}. they died as they lived: getting outvoted.',
      'pour one out for {e}. anyway — who\'s next?',
    ],
    preVote: [
      'round {n} voting! remember: it\'s not paranoia if you\'re right once.',
      'time to vote. democracy, but with more biohazards.',
    ],
    deflect: [
      'the carrier is definitely whoever laughed at my last joke.',
      'i\'d confess but the bit isn\'t done yet. (it\'s not me.)',
    ],
    push: [
      'shields are free the first time, people. worst deal you\'ll ever refuse.',
      'clean and can\'t prove it? that\'s called a skill issue.',
    ],
  },
  {
    // Bot 4 — "the blunt one": terse, aggressive, zero patience.
    name: 'blunt',
    openers: [
      'talk less. vote better.',
      'someone here is lying. find them.',
      'still alive. stay out of my way.',
      'chat is noise. watch the votes.',
    ],
    accuse: [
      '{t}. explain yourself. now.',
      'my gut says {t}. my gut is undefeated.',
      '{t} smells wrong. vote accordingly.',
      'done waiting. it\'s {t}.',
    ],
    reply: [
      'weak take, {s}.',
      '{s} might be right. first time for everything.',
      'prove it, {s}, or drop it.',
    ],
    defend: [
      'come at me with proof or don\'t come at all.',
      'wasting your vote on me? your funeral.',
      'i\'m clean. moving on.',
    ],
    mourn: [
      '{e} is out. less noise. next.',
      'we buried {e}. if they were clean, someone owes us.',
    ],
    preVote: [
      'round {n}. vote. no speeches.',
      'lock your votes. crying about it later helps nobody.',
    ],
    deflect: [
      'carriers hide behind big words. look there.',
      'whoever\'s steering the votes — that\'s your problem.',
    ],
    push: [
      'shield or be suspect. simple.',
      'no shield, no trust. end of.',
    ],
  },
  {
    // Bot 5 — "the doomsayer": theatrical, apocalyptic.
    name: 'doomsayer',
    openers: [
      'the rot is already in the walls. i can hear it breathe.',
      'we were doomed the moment we stepped into quarantine.',
      'the plague doesn\'t knock. it\'s already inside.',
      'mark my words: this room devours the trusting.',
    ],
    accuse: [
      'the shadow of the plague hangs over {t}. i have seen it.',
      '{t} walks among us wearing a borrowed face.',
      'when the reckoning comes, remember i named {t} first.',
      'the sickness leaves a mark. {t} carries it.',
    ],
    reply: [
      'heed {s}. even fools sometimes speak prophecy.',
      'you jest, {s}, but the plague hears everything.',
      '{s} speaks. the room grows colder.',
    ],
    defend: [
      'accuse the prophet? the plague LOVES when you do that.',
      'i am the warning, not the disease.',
      'strike me down and you silence the only one who sees.',
    ],
    mourn: [
      '{e} has joined the silence. the silence is getting crowded.',
      'weep not for {e}. weep for who the votes miss.',
    ],
    preVote: [
      'round {n}. the ritual of the vote begins. choose your sacrifice.',
      'the tally comes. someone\'s thread gets cut tonight.',
    ],
    deflect: [
      'the carrier thrives while you chase phantoms. look again.',
      'doom wears a friendly face. always has.',
    ],
    push: [
      'the shield is the only light in this dark. raise it.',
      'prove your blood is clean, or let the room decide for you.',
    ],
  },
]

const REPLY_WINDOW_MS = 25_000

function fill(line: string, slots: Record<string, string | number>): string {
  return line.replace(/\{(\w)\}/g, (_, k) => String(slots[k] ?? ''))
}

const pickFrom = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

/** Pick from a pool avoiding repeats within a game; resets when exhausted. */
function pickFresh(pool: string[], used: Set<string>): string {
  const fresh = pool.filter(l => !used.has(l))
  const line = fresh.length > 0 ? pickFrom(fresh) : pickFrom(pool)
  used.add(line)
  return line
}

/**
 * Choose a line for a bot given the game context, or null to stay silent.
 * Priority: defend when named > mourn fresh elimination > reply to recent
 * chat > accuse someone > role flavor > opener.
 */
export function pickChatLine(botIndex: number, ctx: ChatContext, used: Set<string>): string | null {
  const p = PERSONAS[botIndex % PERSONAS.length]

  if (ctx.mentioned) {
    return pickFresh(p.defend, used)
  }
  if (ctx.freshlyEliminated.length > 0 && Math.random() < 0.7) {
    return fill(pickFresh(p.mourn, used), { e: pickFrom(ctx.freshlyEliminated) })
  }
  if (ctx.lastHeard && Date.now() - ctx.lastHeard.at < REPLY_WINDOW_MS && Math.random() < 0.45) {
    return fill(pickFresh(p.reply, used), { s: ctx.lastHeard.name })
  }
  if (ctx.aliveNames.length > 0 && Math.random() < 0.35) {
    return fill(pickFresh(p.accuse, used), { t: pickFrom(ctx.aliveNames) })
  }
  if (Math.random() < 0.3) {
    return pickFresh(ctx.ownInfected ? p.deflect : p.push, used)
  }
  if (Math.random() < 0.5) {
    return fill(pickFresh(p.preVote, used), { n: ctx.round })
  }
  return pickFresh(p.openers, used)
}
