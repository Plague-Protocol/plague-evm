'use client'

import { useState, useEffect, useCallback } from 'react'
import type { GameState, GameEvent, Room } from '@/types/game'

// TODO: Issue #15 - Complete game state management with socket.io

export function useGameState(roomId: string | null) {
  const [state, setState] = useState<GameState>({
    room: null,
    localPlayer: null,
    currentRound: null,
    result: null,
    isConnected: false,
    isLoading: false,
    error: null,
  })

  useEffect(() => {
    if (!roomId) return
    // TODO: Issue #15 - Connect to socket.io room and listen for GameEvents
    // const socket = io(process.env.NEXT_PUBLIC_BACKEND_URL!)
    // socket.emit('join_room', { roomId })
    // socket.on('game_event', handleEvent)
    // return () => socket.disconnect()
  }, [roomId])

  const handleEvent = useCallback((event: GameEvent) => {
    // TODO: Issue #15 - Handle all GameEventType variants and update state
  }, [])

  return state
}
