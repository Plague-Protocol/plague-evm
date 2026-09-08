import {
  STATIONS, HOLD_THRESHOLD, PUSHES_PER_ROUND,
  assignedStation, targetStation, resolvePush, pushAtMs, levelForRound, occupancy,
  type BarricadeAction, type StationId,
} from './barricade'

const ROOM = '77'

/** Builds a roster whose seats all start on `station`, so a test can control
 *  exactly who is standing where without fighting the seeded assignment. */
function rosterAt(round: number, station: StationId, n: number, infectedIdx: number[] = []) {
  const players: { address: string; seatIndex: number; infected: boolean }[] = []
  let seat = 0
  while (players.length < n) {
    if (assignedStation(ROOM, round, seat) === station) {
      players.push({
        address: `0xp${players.length}`,
        seatIndex: seat,
        infected: infectedIdx.includes(players.length),
      })
    }
    seat++
    if (seat > 5_000) throw new Error('no seats found')
  }
  return players
}

/** Finds a round whose first push targets `station`. */
function roundTargeting(station: StationId): number {
  for (let r = 1; r < 5_000; r++) if (targetStation(ROOM, r, 0) === station) return r
  throw new Error('no round found')
}

describe('barricade', () => {
  describe('assignment', () => {
    it('is deterministic, so every client renders the same board', () => {
      expect(assignedStation(ROOM, 2, 5)).toBe(assignedStation(ROOM, 2, 5))
      expect(targetStation(ROOM, 2, 1)).toBe(targetStation(ROOM, 2, 1))
    })

    it('always lands on a real station', () => {
      for (let seat = 0; seat < 200; seat++) {
        expect(assignedStation(ROOM, 3, seat)).toBeLessThan(STATIONS.length)
        expect(assignedStation(ROOM, 3, seat)).toBeGreaterThanOrEqual(0)
      }
    })

    it('varies by round, so a room is not the same board every time', () => {
      const a = Array.from({ length: 12 }, (_, i) => assignedStation(ROOM, 1, i)).join('')
      const b = Array.from({ length: 12 }, (_, i) => assignedStation(ROOM, 2, i)).join('')
      expect(a).not.toBe(b)
    })

    it('schedules every push inside the discussion window, in order, at every level', () => {
      const win = 180_000
      for (const round of [1, 2, 3, 4, 5, 9]) {
        const n = levelForRound(round).pushes
        const times = Array.from({ length: n }, (_, i) => pushAtMs(win, i, round))
        expect(times).toEqual([...times].sort((x, y) => x - y))
        // The last push must leave room to be argued about before voting.
        expect(times[times.length - 1]).toBeLessThan(win * 0.85)
        expect(times[0]).toBeGreaterThan(0)
        expect(new Set(times).size).toBe(n) // no two pushes land together
      }
    })
  })

  describe('inaction is a move', () => {
    // The property the whole bot design rests on: sending nothing is holding
    // your post, and holding your post defends the station.
    it('treats an absent action as defending the assigned station', () => {
      const round = roundTargeting(1)
      const players = rosterAt(round, 1, 3)
      const out = resolvePush({ roomId: ROOM, round, push: 0, players, actions: new Map() })
      expect(out.present).toBe(3)
      expect(out.held).toBe(true)
    })

    it('is indistinguishable from an explicit hold', () => {
      const round = roundTargeting(1)
      const players = rosterAt(round, 1, 3)
      const silent = resolvePush({ roomId: ROOM, round, push: 0, players, actions: new Map() })
      const explicit = resolvePush({
        roomId: ROOM, round, push: 0, players,
        actions: new Map(players.map(p => [p.address, { kind: 'hold' } as BarricadeAction])),
      })
      expect({ ...silent, at: 0 }).toEqual({ ...explicit, at: 0 })
    })
  })

  describe('evidence asymmetry', () => {
    it('names nobody when the station holds', () => {
      const round = roundTargeting(0)
      const players = rosterAt(round, 0, 4)
      const out = resolvePush({ roomId: ROOM, round, push: 0, players, actions: new Map() })
      expect(out.held).toBe(true)
      expect(out.exposed).toEqual([])
      expect(out.present).toBe(4) // the count is still public
    })

    it('names everyone present when the station breaks', () => {
      const round = roundTargeting(0)
      const players = rosterAt(round, 0, 1) // below threshold on its own
      const out = resolvePush({ roomId: ROOM, round, push: 0, players, actions: new Map() })
      expect(out.held).toBe(false)
      expect(out.exposed).toEqual(players.map(p => p.address))
    })

    // The reason sabotage is a real decision rather than a confession.
    it('hides a saboteur whose station holds anyway', () => {
      const round = roundTargeting(0)
      const players = rosterAt(round, 0, 5, [0])
      const actions = new Map<string, BarricadeAction>([[players[0].address, { kind: 'sabotage' }]])
      const out = resolvePush({ roomId: ROOM, round, push: 0, players, actions })
      expect(out.held).toBe(true)      // 4 defenders - 1 saboteur = 3
      expect(out.exposed).toEqual([])  // nobody learns anything
    })

    // And the reason clean players get wrongly accused, which is the good part.
    it('exposes innocents alongside the saboteur on a breach', () => {
      const round = roundTargeting(0)
      const players = rosterAt(round, 0, 3, [0])
      const actions = new Map<string, BarricadeAction>([[players[0].address, { kind: 'sabotage' }]])
      const out = resolvePush({ roomId: ROOM, round, push: 0, players, actions })
      expect(out.held).toBe(false)                 // 2 defenders - 1 = 1 < 2
      expect(out.exposed).toHaveLength(3)          // all three named
      expect(out.exposed).toEqual(expect.arrayContaining(players.map(p => p.address)))
    })
  })

  describe('sabotage validity', () => {
    it('degrades a clean player’s sabotage to a plain defence', () => {
      const round = roundTargeting(0)
      const players = rosterAt(round, 0, 2) // nobody infected
      const actions = new Map<string, BarricadeAction>([[players[0].address, { kind: 'sabotage' }]])
      const out = resolvePush({ roomId: ROOM, round, push: 0, players, actions })
      expect(out.held).toBe(true) // counted as +1, so 2 >= threshold
    })
  })

  describe('movement', () => {
    it('counts a player at the station they moved to', () => {
      const round = roundTargeting(0)
      const away = rosterAt(round, 1, 2) // assigned elsewhere
      const actions = new Map<string, BarricadeAction>(
        away.map(p => [p.address, { kind: 'move', station: 0 } as BarricadeAction]),
      )
      const out = resolvePush({ roomId: ROOM, round, push: 0, players: away, actions })
      expect(out.present).toBe(2)
      expect(out.held).toBe(true)
    })

    it('leaves a station undefended when everyone walks away', () => {
      const round = roundTargeting(0)
      const players = rosterAt(round, 0, 3)
      const actions = new Map<string, BarricadeAction>(
        players.map(p => [p.address, { kind: 'move', station: 2 } as BarricadeAction]),
      )
      const out = resolvePush({ roomId: ROOM, round, push: 0, players, actions })
      expect(out.present).toBe(0)
      expect(out.held).toBe(false)
      expect(out.exposed).toEqual([]) // nobody was there to be exposed
    })
  })

  describe('the arc', () => {
    it('never gets easier as the night goes on', () => {
      let prev = levelForRound(1)
      for (let r = 2; r <= 12; r++) {
        const cur = levelForRound(r)
        expect(cur.pushes).toBeGreaterThanOrEqual(prev.pushes)
        expect(cur.threshold).toBeGreaterThanOrEqual(prev.threshold)
        prev = cur
      }
    })

    it('actually escalates rather than flatlining', () => {
      const first = levelForRound(1)
      const late = levelForRound(9)
      expect(late.pushes + late.threshold).toBeGreaterThan(first.pushes + first.threshold)
    })

    it('opens at the documented baseline', () => {
      expect(levelForRound(1).pushes).toBe(PUSHES_PER_ROUND)
      expect(levelForRound(1).threshold).toBe(HOLD_THRESHOLD)
    })

    it('treats round 0 and negatives as the opening level', () => {
      expect(levelForRound(0)).toEqual(levelForRound(1))
      expect(levelForRound(-3)).toEqual(levelForRound(1))
    })

    // Escalation has to bite somewhere. It is the number of walls attacked
    // per round, not the bar any single wall has to clear — see the note on
    // LEVELS for why raising the bar would cost the game its ambiguity.
    it('sends more pushes as the night goes on', () => {
      expect(levelForRound(9).pushes).toBeGreaterThan(levelForRound(1).pushes)
      let prev = levelForRound(1).pushes
      for (let r = 2; r <= 12; r++) {
        const cur = levelForRound(r).pushes
        expect(cur).toBeGreaterThanOrEqual(prev)
        prev = cur
      }
    })

    it('still cannot cover every wall, at any level', () => {
      // Four walls at a threshold of 2 needs eight bodies to be safe
      // everywhere. A room never has that many, so something is always open.
      for (const round of [1, 5, 11]) {
        expect(STATIONS.length * levelForRound(round).threshold).toBeGreaterThan(6)
      }
    })

    // Escalation must never turn into a reflex or connection test.
    it('keeps holding your post legal at every level', () => {
      for (const round of [1, 3, 5, 11]) {
        const target = targetStation(ROOM, round, 0)
        const need = levelForRound(round).threshold
        const out = resolvePush({
          roomId: ROOM, round, push: 0,
          players: rosterAt(round, target, need), actions: new Map(),
        })
        expect(out.held).toBe(true)
      }
    })
  })

  describe('occupancy', () => {
    it('counts every body exactly once', () => {
      const players = Array.from({ length: 7 }, (_, i) => ({ address: `0x${i}`, seatIndex: i }))
      const counts = occupancy(ROOM, 4, players, new Map())
      expect(counts).toHaveLength(STATIONS.length)
      expect(counts.reduce((a, b) => a + b, 0)).toBe(7)
    })

    it('follows a player who moved', () => {
      const players = [{ address: '0xa', seatIndex: 0 }]
      const home = assignedStation(ROOM, 4, 0)
      const away = ((home + 1) % STATIONS.length) as StationId
      const counts = occupancy(ROOM, 4, players,
        new Map([['0xa', { kind: 'move', station: away }]]))
      expect(counts[away]).toBe(1)
      expect(counts[home]).toBe(0)
    })

    // The property the cam depends on: it must be safe to broadcast.
    it('leaks no identities — it is numbers and nothing else', () => {
      const players = Array.from({ length: 5 }, (_, i) => ({ address: `0xdead${i}`, seatIndex: i }))
      const counts = occupancy(ROOM, 2, players, new Map())
      expect(counts.every(c => typeof c === 'number')).toBe(true)
      expect(JSON.stringify(counts)).not.toMatch(/0xdead/)
    })

    it('treats a sabotaging player as present where they stand', () => {
      const players = [{ address: '0xa', seatIndex: 0 }]
      const home = assignedStation(ROOM, 4, 0)
      const counts = occupancy(ROOM, 4, players, new Map([['0xa', { kind: 'sabotage' }]]))
      expect(counts[home]).toBe(1)
    })
  })

  describe('ambiguity — the property the whole design rests on', () => {
    /**
     * A wall that breaks with exactly ONE person on it must be explicable both
     * ways: they sabotaged it, or nobody came to help them.
     *
     * This is what a threshold of 1 would destroy. At 1, a lone clean defender
     * contributes +1 and holds, so a solo break could only ever be sabotage —
     * one name on the board would be a confirmed carrier, and the barricade
     * would start producing proofs instead of arguments.
     */
    it('a lone defender breaking a wall could be innocent OR guilty', () => {
      for (const round of [1, 2, 3, 4, 6, 9]) {
        const target = targetStation(ROOM, round, 0)
        const [seat] = rosterAt(round, target, 1)

        const innocent = resolvePush({
          roomId: ROOM, round, push: 0,
          players: [{ ...seat, infected: false }], actions: new Map(),
        })
        const guilty = resolvePush({
          roomId: ROOM, round, push: 0,
          players: [{ ...seat, infected: true }],
          actions: new Map([[seat.address, { kind: 'sabotage' } as BarricadeAction]]),
        })

        // Both break, and both name exactly that one person — so the board
        // looks identical either way.
        expect(innocent.held).toBe(false)
        expect(guilty.held).toBe(false)
        expect(innocent.exposed).toEqual(guilty.exposed)
      }
    })

    it('holding is still achievable without sabotage at every level', () => {
      for (const round of [1, 2, 3, 4, 6, 9]) {
        const target = targetStation(ROOM, round, 0)
        const need = levelForRound(round).threshold
        const out = resolvePush({
          roomId: ROOM, round, push: 0,
          players: rosterAt(round, target, need), actions: new Map(),
        })
        expect(out.held).toBe(true)
      }
    })

    // Escalation moved to the push count precisely so this stays true.
    it('never raises the bar on a single wall', () => {
      for (let r = 1; r <= 15; r++) {
        expect(levelForRound(r).threshold).toBe(levelForRound(1).threshold)
      }
    })
  })

  it('never returns an elimination — it only ever produces evidence', () => {
    const round = roundTargeting(0)
    const players = rosterAt(round, 0, 4, [0, 1])
    const actions = new Map<string, BarricadeAction>([
      [players[0].address, { kind: 'sabotage' }],
      [players[1].address, { kind: 'sabotage' }],
    ])
    const out = resolvePush({ roomId: ROOM, round, push: 0, players, actions })
    expect(Object.keys(out).sort()).toEqual(['at', 'exposed', 'held', 'present', 'push', 'station'])
    expect(HOLD_THRESHOLD).toBeGreaterThan(0)
  })
})
