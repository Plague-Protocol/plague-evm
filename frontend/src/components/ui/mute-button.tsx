'use client'

import { useSound } from '@/providers/sound-provider'

export function MuteButton() {
  const { muted, toggleMute } = useSound()
  return (
    <button
      onClick={toggleMute}
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      title={muted ? 'Unmute' : 'Mute'}
      className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg transition-all duration-150 hover:opacity-90"
      style={{
        backgroundColor: 'rgba(168,85,247,0.12)',
        border: '1px solid rgba(168,85,247,0.25)',
        color: muted ? '#4a5568' : '#a855f7',
      }}
    >
      {muted ? (
        // Muted icon (speaker with X)
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/>
          <line x1="17" y1="9" x2="23" y2="15"/>
        </svg>
      ) : (
        // Sound on icon (speaker with waves)
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      )}
    </button>
  )
}
