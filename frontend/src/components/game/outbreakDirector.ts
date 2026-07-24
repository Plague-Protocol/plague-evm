/**
 * OutbreakDirector — per-client "unreliable narrator" for the quarantine cam.
 *
 * Roles are secret (ZK commitments). What every client legitimately knows is:
 *  - the public counts (players, alive, infected-alive — the last one is
 *    already shown in the sync feed line), and
 *  - the local player's OWN status (private `infection_assigned` event).
 *
 * The director keeps a troupe of anonymous figures consistent with exactly
 * that knowledge and nothing more:
 *  - one figure is "you" and always tells YOUR truth (kind + alive);
 *  - every other figure's role is per-client random fiction — mappings are
 *    never shared or seeded from public data, so two players' screens can't
 *    be correlated to deanonymize anyone;
 *  - when the public counts move, it emits animation cues (electrocution for
 *    the first zombie, bites for later infections, deaths for eliminations)
 *    against fiction-consistent figures.
 *
 * Rebuilt whenever the roster size changes (waiting-room joins); `epoch`
 * bumps so the renderer knows to resync wholesale instead of animating.
 */

export type FigureKind = 'human' | 'zombie'

export interface Figure {
  id: number
  kind: FigureKind
  alive: boolean
  isMe: boolean
}

export type FinaleOutcome = 'clean_win' | 'infected_win' | 'max_rounds_draw'

export type OutbreakCue =
  | { type: 'electrocute'; figureId: number }
  | { type: 'bite'; zombieId: number; victimId: number }
  | { type: 'death'; figureId: number }
  | { type: 'finale'; outcome: FinaleOutcome }

export interface OutbreakSnapshot {
  totalPlayers: number
  aliveCount: number
  /** Infected AND alive — public info (already surfaced by the game UI). */
  zombieCount: number
  /** Local player's own status; null = spectator (no figure is "you"). */
  myStatus: 'clean' | 'infected' | 'eliminated' | null
  outcome: FinaleOutcome | null
}

function pick<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export class OutbreakDirector {
  /** Bumped on every wholesale rebuild — renderer resyncs instead of animating. */
  epoch = 0

  private figures: Figure[] = []
  private finaleDone = false

  getFigures(): readonly Figure[] {
    return this.figures
  }

  update(snap: OutbreakSnapshot): OutbreakCue[] {
    if (snap.totalPlayers <= 0) {
      if (this.figures.length > 0) {
        this.figures = []
        this.epoch++
      }
      return []
    }
    if (this.figures.length !== snap.totalPlayers) {
      this.rebuild(snap)
      return []
    }

    // Wallet connected (or disconnected) after the baseline was built — the
    // troupe has no truthful "you" figure (or a stale one). Re-deal the fiction.
    const hasMe = this.figures.some(f => f.isMe)
    if (hasMe !== (snap.myStatus !== null)) {
      this.rebuild(snap)
      return []
    }

    const cues: OutbreakCue[] = []
    const me = this.figures.find(f => f.isMe)

    // My figure always tells my truth — resolve it first so the random
    // reconciliation below never has to touch it.
    if (me?.alive && snap.myStatus === 'infected' && me.kind === 'human') {
      cues.push(this.infect(me))
    }
    if (me?.alive && snap.myStatus === 'eliminated') {
      me.alive = false
      cues.push({ type: 'death', figureId: me.id })
    }

    // Reconcile the remaining public counts using fiction-only figures.
    // deaths first (reveal phase), then infections (next infection phase);
    // zombie-vs-human death split is forced by the count deltas.
    const zAlive = this.countAlive('zombie')
    const hAlive = this.countAlive('human')
    const deathsNeeded = Math.max(0, zAlive + hAlive - snap.aliveCount)
    const zombieDeaths = Math.min(deathsNeeded, Math.max(0, zAlive - snap.zombieCount))
    const humanDeaths = deathsNeeded - zombieDeaths

    for (let k = 0; k < zombieDeaths; k++) {
      const f = pick(this.fictionAlive('zombie'))
      if (!f) break
      f.alive = false
      cues.push({ type: 'death', figureId: f.id })
    }
    for (let k = 0; k < humanDeaths; k++) {
      const f = pick(this.fictionAlive('human'))
      if (!f) break
      f.alive = false
      cues.push({ type: 'death', figureId: f.id })
    }

    const infections = Math.max(0, snap.zombieCount - this.countAlive('zombie'))
    for (let k = 0; k < infections; k++) {
      const victim = pick(this.fictionAlive('human'))
      if (!victim) break
      cues.push(this.infect(victim))
    }

    // Safety net: if reconciliation couldn't reach the public counts, the
    // state moved in a way no live game can (resurrection / cure — e.g. the
    // demo restarting in place). Re-deal the whole fiction instead of lying.
    if (
      this.figures.filter(f => f.alive).length !== snap.aliveCount ||
      this.countAlive('zombie') !== snap.zombieCount
    ) {
      this.rebuild(snap)
      return []
    }

    if (snap.outcome && !this.finaleDone) {
      this.finaleDone = true
      cues.push({ type: 'finale', outcome: snap.outcome })
    }
    return cues
  }

  /** Turn a human figure. First zombie ever = struck by the plague; later ones get bitten. */
  private infect(victim: Figure): OutbreakCue {
    const biter = pick(this.figures.filter(f => f.alive && f.kind === 'zombie' && f.id !== victim.id))
    victim.kind = 'zombie'
    if (!biter) return { type: 'electrocute', figureId: victim.id }
    return { type: 'bite', zombieId: biter.id, victimId: victim.id }
  }

  private countAlive(kind: FigureKind): number {
    return this.figures.filter(f => f.alive && f.kind === kind).length
  }

  /** Alive figures of `kind` excluding "you" — the only pool fiction may touch. */
  private fictionAlive(kind: FigureKind): Figure[] {
    return this.figures.filter(f => f.alive && f.kind === kind && !f.isMe)
  }

  private rebuild(snap: OutbreakSnapshot): void {
    const n = snap.totalPlayers
    const figures: Figure[] = Array.from({ length: n }, (_, id) => ({
      id,
      kind: 'human' as FigureKind,
      alive: true,
      isMe: false,
    }))

    // Even "your" slot index is random so screen position ≠ join order.
    const me = snap.myStatus !== null ? figures[Math.floor(Math.random() * n)] : undefined
    if (me) {
      me.isMe = true
      if (snap.myStatus === 'infected') me.kind = 'zombie'
      if (snap.myStatus === 'eliminated') me.alive = false
    }

    let deadNeeded = n - snap.aliveCount - (me && !me.alive ? 1 : 0)
    for (const f of shuffle(figures)) {
      if (deadNeeded <= 0) break
      if (f.isMe || !f.alive) continue
      f.alive = false
      deadNeeded--
    }

    let zombiesNeeded = snap.zombieCount - (me?.alive && me.kind === 'zombie' ? 1 : 0)
    for (const f of shuffle(figures)) {
      if (zombiesNeeded <= 0) break
      if (f.isMe || !f.alive || f.kind === 'zombie') continue
      f.kind = 'zombie'
      zombiesNeeded--
    }

    this.figures = figures
    this.finaleDone = snap.outcome !== null
    this.epoch++
  }
}
