import * as presence from './presence'

const ROOM = '42'
const A = '0xAAaa'
const B = '0xBBbb'

/** Room active (2), discussion phase (1), no Silent Round. */
function openGate(roomId = ROOM) {
  presence.noteRoomGate(roomId, { status: 2, phase: 1, silenced: false })
}

describe('presence', () => {
  let frames: presence.PresenceFrame[]
  const emit = (_roomId: string, frame: presence.PresenceFrame) => { frames.push(frame) }

  beforeEach(() => {
    jest.useFakeTimers()
    presence.stopAll()
    frames = []
  })
  afterEach(() => {
    presence.stopAll()
    jest.useRealTimers()
  })

  describe('eligibility gate', () => {
    it('fails closed for a room it has never seen', () => {
      presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(5_000)
      expect(frames).toHaveLength(0)
    })

    it('stays closed during voting', () => {
      presence.noteRoomGate(ROOM, { status: 2, phase: 2, silenced: false })
      presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(5_000)
      expect(frames).toHaveLength(0)
    })

    // A Silent Round removes chat precisely so the table cannot read who wants
    // to speak; a typing dot would hand that back.
    it('stays closed during a Silent Round', () => {
      presence.noteRoomGate(ROOM, { status: 2, phase: 1, silenced: true })
      presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(5_000)
      expect(frames).toHaveLength(0)
    })

    it('stays closed once the game has ended', () => {
      presence.noteRoomGate(ROOM, { status: 3, phase: 1, silenced: false })
      presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(5_000)
      expect(frames).toHaveLength(0)
    })

    it('goes stale rather than trusting an old read', () => {
      openGate()
      expect(presence.gateOpen(ROOM)).toBe(true)
      jest.advanceTimersByTime(6_000)
      expect(presence.gateOpen(ROOM)).toBe(false)
    })
  })

  describe('egress discipline', () => {
    it('coalesces a burst of keystrokes into a single frame', () => {
      openGate()
      for (let i = 0; i < 50; i++) presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(1_000)
      expect(frames).toHaveLength(1)
      expect(frames[0].typing).toEqual([A.toLowerCase()])
    })

    it('never re-sends an unchanged state', () => {
      openGate()
      presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(1_000)
      expect(frames).toHaveLength(1)
      // Same player still typing, refreshed repeatedly — no new information.
      for (let i = 0; i < 5; i++) {
        presence.setTyping(ROOM, A, true, emit)
        jest.advanceTimersByTime(1_000)
      }
      expect(frames).toHaveLength(1)
    })

    it('sends the empty state once so the indicator clears', () => {
      openGate()
      presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(1_000)
      presence.setTyping(ROOM, A, false, emit)
      jest.advanceTimersByTime(1_000)
      expect(frames).toHaveLength(2)
      expect(frames[1].typing).toEqual([])
      // ...and then stops. A quiet room must not emit a heartbeat frame.
      jest.advanceTimersByTime(30_000)
      expect(frames).toHaveLength(2)
    })
  })

  describe('expiry', () => {
    // A client that dies mid-sentence sends no "false" — the entry has to age
    // out on its own or the dot pulses next to that name forever.
    it('expires a stale typing entry without a stop signal', () => {
      openGate()
      presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(1_000)
      expect(frames[0].typing).toEqual([A.toLowerCase()])
      openGate() // keep the gate fresh; only the typing entry should age out
      jest.advanceTimersByTime(5_000)
      expect(frames[frames.length - 1].typing).toEqual([])
    })
  })

  describe('multi-player', () => {
    it('reports everyone typing, in a stable order', () => {
      openGate()
      presence.setTyping(ROOM, B, true, emit)
      presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(1_000)
      expect(frames[0].typing).toEqual([A.toLowerCase(), B.toLowerCase()])
    })

    it('drops a player from every room on disconnect', () => {
      openGate()
      presence.setTyping(ROOM, A, true, emit)
      jest.advanceTimersByTime(1_000)
      presence.clearPlayer(A, emit)
      jest.advanceTimersByTime(1_000)
      expect(frames[frames.length - 1].typing).toEqual([])
    })
  })

  it('releases room state so a finished game leaves nothing behind', () => {
    openGate()
    presence.setTyping(ROOM, A, true, emit)
    presence.clearRoom(ROOM)
    jest.advanceTimersByTime(10_000)
    expect(frames).toHaveLength(0)
    expect(presence.gateOpen(ROOM)).toBe(false)
  })
})
