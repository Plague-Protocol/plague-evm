import { RANKS, rankFor, progressFor } from './ranks'
import { POINTS } from './points'

describe('ranks', () => {
  describe('ladder shape', () => {
    it('is strictly ascending in both tier and threshold', () => {
      for (let i = 1; i < RANKS.length; i++) {
        expect(RANKS[i].tier).toBe(RANKS[i - 1].tier + 1)
        expect(RANKS[i].at).toBeGreaterThan(RANKS[i - 1].at)
      }
    })

    it('starts at zero, so a brand-new player already has a rank', () => {
      expect(RANKS[0].at).toBe(0)
      expect(rankFor(0).name).toBe(RANKS[0].name)
    })

    // The failure mode this ladder exists to avoid: thresholds tuned for a game
    // with hourly sessions, dropped on one that plays twice a day.
    it('is reachable at this game’s actual scoring rate', () => {
      // Two games, both LOSSES, should already be visible progress.
      const twoLosses = POINTS.loss * 2
      expect(progressFor(twoLosses).fraction).toBeGreaterThan(0)
      // Two wins should clear the second rung outright.
      expect(rankFor(POINTS.win * 2).tier).toBeGreaterThanOrEqual(2)
    })

    it('does not name a rank after an in-game role', () => {
      const roleWords = ['patient zero', 'carrier', 'clean', 'infected']
      for (const r of RANKS) {
        expect(roleWords).not.toContain(r.name.toLowerCase())
      }
    })
  })

  describe('progress', () => {
    it('reports the next rung and the gap to it', () => {
      const p = progressFor(RANKS[0].at)
      expect(p.rank.name).toBe(RANKS[0].name)
      expect(p.next?.name).toBe(RANKS[1].name)
      expect(p.toNext).toBe(RANKS[1].at)
    })

    it('lands exactly on a threshold as that rank, not the one below', () => {
      for (const r of RANKS) expect(rankFor(r.at).name).toBe(r.name)
    })

    it('tops out cleanly with no next rung', () => {
      const top = RANKS[RANKS.length - 1]
      const p = progressFor(top.at + 500)
      expect(p.rank.name).toBe(top.name)
      expect(p.next).toBeNull()
      expect(p.toNext).toBe(0)
      expect(p.fraction).toBe(1)
    })

    it('keeps fraction inside 0..1 across the whole ladder', () => {
      for (let pts = 0; pts < RANKS[RANKS.length - 1].at + 100; pts += 3) {
        const f = progressFor(pts).fraction
        expect(f).toBeGreaterThanOrEqual(0)
        expect(f).toBeLessThanOrEqual(1)
      }
    })

    it('moves after a single game in every band', () => {
      // A win must visibly advance the bar wherever the player currently sits.
      for (const r of RANKS.slice(0, -1)) {
        const before = progressFor(r.at).fraction
        const after = progressFor(r.at + POINTS.win).fraction
        expect(after).toBeGreaterThan(before)
      }
    })

    it('treats junk input as a fresh player rather than throwing', () => {
      for (const bad of [-5, NaN, Infinity]) {
        expect(() => progressFor(bad)).not.toThrow()
        expect(progressFor(bad).rank.name).toBe(RANKS[0].name)
      }
    })
  })
})
