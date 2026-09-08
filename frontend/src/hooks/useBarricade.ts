'use client'

/**
 * useBarricade — client state for the Discussion-phase minigame.
 *
 * Holds the server's board, the local player's intent, and the one socket
 * message per decision that carries it.
 *
 * 🚨 EGRESS. A player sends at most one small message per push — three per
 * round — and only when they actively choose something. Holding your post,
 * which is the common case, sends NOTHING at all: the server already treats an
 * absent action as holding, so the quiet majority costs zero bytes. Inbound is
 * likewise event-driven (a warning and a result per push), and the countdown is
 * animated locally from a timestamp rather than ticked over the wire.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import {
  assignedStation,
  type BarricadeAction, type BarricadeState, type StationId,
} from '@/lib/barricade'

export function useBarricade(
  socket: Socket | null,
  roomId: string | null,
  address: string | null | undefined,
  /** The local player's index in room.players — the chain seat order the
   *  server assigns from. -1 when the player is not seated. */
  seatIndex: number,
) {
  const [state, setState] = useState<BarricadeState | null>(null)
  const [choice, setChoice] = useState<BarricadeAction>({ kind: 'hold' })
  const lastPushRef = useRef<number>(-1)

  useEffect(() => {
    if (!socket || !roomId) { setState(null); return }
    const onBarricade = (next: BarricadeState) => {
      if (next?.roomId !== roomId) return
      setState(next)
    }
    socket.on('barricade', onBarricade)
    return () => { socket.off('barricade', onBarricade) }
  }, [socket, roomId])

  // Each push collects its own intent, so the choice resets to HOLD once one
  // resolves. Carrying it over would silently commit a player to a station they
  // picked for a threat that has already passed.
  const resolvedCount = state?.outcomes.length ?? -1
  useEffect(() => {
    if (resolvedCount === lastPushRef.current) return
    lastPushRef.current = resolvedCount
    setChoice({ kind: 'hold' })
  }, [resolvedCount])

  // A new round is a new board.
  const round = state?.round ?? 0
  useEffect(() => { setChoice({ kind: 'hold' }) }, [round])

  const choose = useCallback((action: BarricadeAction) => {
    setChoice(action)
    if (!socket || !roomId || !address) return
    socket.emit('barricade_action', { roomId, playerAddress: address, action })
  }, [socket, roomId, address])

  const assigned: StationId | null =
    state && seatIndex >= 0 ? assignedStation(roomId ?? '', state.round, seatIndex) : null

  /**
   * Where the player is ACTUALLY standing — their choice if they moved, their
   * assigned post otherwise.
   *
   * The cam was previously fed the assigned wall, so tapping a wall changed the
   * button state and nothing else: your figure stayed where it started and the
   * control looked broken. Deriving it from the live choice also means the run
   * starts on the tap rather than waiting for the server to echo the move back.
   */
  const myStation: StationId | null =
    choice.kind === 'move' ? choice.station : assigned

  return { state, choice, choose, myStation, assignedStation: assigned }
}
