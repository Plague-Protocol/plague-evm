'use client'

/**
 * usePresence — the "who is at the table right now" layer for the game room.
 *
 * Discussion runs for 180 seconds and, between chat messages, a room full of
 * people thinking looked exactly like an empty one. This surfaces the one
 * liveness signal that is both free and meaningful: who is composing.
 *
 * It is genuine deduction material rather than decoration — a player who starts
 * typing, stops, and starts again is telling you something — and it discloses
 * nothing secret. Infection status never passes through here.
 *
 * 🚨 EGRESS. The VPS runs under a 512 GB/month outbound cap, so the client half
 * of this is rate-limited as strictly as the server half (backend/src/lib/
 * presence.ts):
 *   - A "typing" ping goes out at most once per REFRESH_MS while the composer
 *     is active — never per keystroke.
 *   - A single "stopped" ping is sent when the field empties or goes idle.
 *   - Inbound frames are already coalesced and change-only by the server.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'

/** How often an actively-typing composer refreshes its signal. Must stay well
 *  under the server's TYPING_TTL_MS (4 s) or the indicator will flicker off
 *  between refreshes. */
const REFRESH_MS = 2_000
/** Silence after the last keystroke before we declare the composer idle. */
const IDLE_MS = 3_000

interface PresenceFrame {
  roomId: string
  typing: string[]
  at: number
}

export function usePresence(
  socket: Socket | null,
  roomId: string | null,
  address: string | null | undefined,
) {
  const [typingAddrs, setTypingAddrs] = useState<string[]>([])

  // Last state we told the server, so a steady stream of keystrokes collapses
  // into one ping per REFRESH_MS instead of one per character.
  const sentAtRef = useRef(0)
  const sentTypingRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!socket || !roomId) { setTypingAddrs([]); return }
    const onPresence = (frame: PresenceFrame) => {
      if (frame?.roomId !== roomId) return
      setTypingAddrs(Array.isArray(frame.typing) ? frame.typing : [])
    }
    socket.on('presence', onPresence)
    return () => { socket.off('presence', onPresence) }
  }, [socket, roomId])

  const send = useCallback((isTyping: boolean) => {
    if (!socket || !roomId || !address) return
    sentTypingRef.current = isTyping
    sentAtRef.current = Date.now()
    socket.emit('presence_typing', { roomId, playerAddress: address, typing: isTyping })
  }, [socket, roomId, address])

  /** Call on every change of the chat field. Cheap to call at keystroke rate. */
  const noteActivity = useCallback((hasContent: boolean) => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)

    if (!hasContent) {
      if (sentTypingRef.current) send(false)
      return
    }
    // Refresh at most every REFRESH_MS while the composer stays active.
    if (!sentTypingRef.current || Date.now() - sentAtRef.current > REFRESH_MS) send(true)

    idleTimerRef.current = setTimeout(() => {
      if (sentTypingRef.current) send(false)
    }, IDLE_MS)
  }, [send])

  /** Call when a message is actually sent — clears the indicator immediately. */
  const noteSent = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (sentTypingRef.current) send(false)
  }, [send])

  // Leaving the page mid-sentence must not strand a dot next to your name.
  useEffect(() => () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (sentTypingRef.current && socket && roomId && address) {
      socket.emit('presence_typing', { roomId, playerAddress: address, typing: false })
      sentTypingRef.current = false
    }
  }, [socket, roomId, address])

  // Never show the local player their own dot.
  const others = typingAddrs.filter(a => a !== (address ?? '').toLowerCase())

  return { typingAddrs: others, noteActivity, noteSent }
}
