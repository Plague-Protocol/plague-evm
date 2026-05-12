'use client'

import { useEffect, useState } from 'react'

export type GameTab = 'game' | 'board' | 'chat' | 'feed'

interface GameTabNavProps {
  readonly activeTab: GameTab
  readonly onTabChange: (tab: GameTab) => void
  readonly unreadChat: number
}

const TABS: { id: GameTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'game',
    label: 'Game',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4l2 2" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: 'board',
    label: 'Board',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'feed',
    label: 'Feed',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
]

export function GameTabNav({ activeTab, onTabChange, unreadChat }: GameTabNavProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <nav className="game-tab-bar" aria-label="Game navigation">
      <div className="flex items-stretch justify-around">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors duration-150"
              style={{
                color: isActive ? '#39ff14' : '#4a5e44',
              }}
              aria-current={isActive ? 'page' : undefined}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full"
                  style={{ backgroundColor: '#39ff14', boxShadow: '0 0 8px rgba(57,255,20,0.6)' }}
                />
              )}

              {/* Icon */}
              <span className="relative">
                {tab.icon}
                {/* Unread badge on chat */}
                {tab.id === 'chat' && unreadChat > 0 && (
                  <span
                    className="absolute -top-1 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold leading-none"
                    style={{
                      backgroundColor: '#e63329',
                      color: '#fff',
                      boxShadow: '0 0 6px rgba(230,51,41,0.6)',
                    }}
                  >
                    {unreadChat > 99 ? '99+' : unreadChat}
                  </span>
                )}
              </span>

              {/* Label */}
              <span
                className="font-mono text-[10px] uppercase tracking-wider"
                style={{ fontWeight: isActive ? 700 : 400 }}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
