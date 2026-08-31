'use client'

/**
 * ModifierBanner — announces the room's rule variant.
 *
 * A hidden rule is a bug, not a twist: a player who cannot chat needs to know
 * it is the Silent Round and not a broken socket. The modifier is derived from
 * the room id, so this renders the same answer the server is enforcing.
 */

import { roomModifier } from '@/lib/roomModifiers'

export function ModifierBanner({ roomId, round }: { readonly roomId: string; readonly round: number }) {
  const mod = roomModifier(roomId)
  if (mod.kind === 'none') return null

  // Silent rounds announce themselves for the whole game so players can plan
  // for the round, then read as live once it arrives.
  const live = mod.kind !== 'silent' || mod.round === round

  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded border px-3 py-2"
      style={{
        borderColor: live ? 'var(--accent-toxic)' : 'var(--bg-tertiary)',
        backgroundColor: 'var(--bg-secondary)',
        opacity: live ? 1 : 0.7,
      }}
    >
      <span
        className="font-heading text-xs font-bold uppercase tracking-wide"
        style={{ color: live ? 'var(--accent-toxic)' : 'var(--text-muted)' }}
      >
        {live ? '● ' : '○ '}{mod.label}
      </span>
      <span className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        {mod.blurb}
      </span>
    </div>
  )
}
