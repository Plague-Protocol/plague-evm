'use client'

/**
 * ExpandableCard — a homepage card that shows its title and opens on tap.
 *
 * 🚨 THE BODY IS ALWAYS IN THE DOM.
 * Collapsed is `max-height: 0`, never `{open && <p>}`. The page's own value —
 * the fee, the contract address, the fact that agents hold seats — is read by
 * crawlers and automated reviewers straight out of the markup, and two rounds
 * of AskBots review turned on those facts being present. Conditionally
 * rendering the bodies would delete them from the HTML and quietly undo that,
 * with nothing visibly broken to notice. Keep the content mounted.
 *
 * 🚨 ONE AT A TIME.
 * Opening a card closes its siblings, which is what keeps a section of four
 * cards roughly one screen tall on a phone instead of six. Group membership is
 * by `group` prop — cards sharing a group are mutually exclusive; different
 * groups are independent.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * Which card is open, per group.
 *
 * Module scope rather than context: the homepage renders four independent
 * groups and none of them needs a provider. Subscribers are notified on every
 * change and re-check their own group, which is cheap at this size.
 */
const openByGroup = new Map<string, string>()
const subscribers = new Set<() => void>()

function setOpenCard(group: string, id: string | null) {
  if (id === null) openByGroup.delete(group)
  else openByGroup.set(group, id)
  for (const notify of subscribers) notify()
}

export interface ExpandableCardProps {
  /** Cards sharing a group close each other. */
  readonly group: string
  readonly title: string
  /** Optional emoji or short label shown above the title. */
  readonly icon?: string
  /** Optional value shown beside the title while collapsed (e.g. "1.5%"). */
  readonly value?: string
  readonly children: ReactNode
}

export function ExpandableCard({ group, title, icon, value, children }: ExpandableCardProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [bodyHeight, setBodyHeight] = useState<number | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const check = () => setOpen(openByGroup.get(group) === id)
    subscribers.add(check)
    check()
    return () => { subscribers.delete(check) }
  }, [group, id])

  // Re-measure whenever this card opens: the body's height depends on how the
  // text wraps, which changes with viewport width, so a height captured once at
  // mount is wrong after a rotation or resize.
  useEffect(() => {
    if (open && bodyRef.current) setBodyHeight(bodyRef.current.scrollHeight)
  }, [open])

  const toggle = useCallback(() => {
    setOpenCard(group, openByGroup.get(group) === id ? null : id)
  }, [group, id])

  return (
    <div
      className="flex flex-col rounded-lg border transition-colors"
      style={{
        backgroundColor: '#0c1309',
        borderColor: open ? 'rgba(201,122,18,0.38)' : 'rgba(107,142,35,0.12)',
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-opacity hover:opacity-90 sm:px-6"
      >
        {icon && <span className="shrink-0 text-2xl" aria-hidden="true">{icon}</span>}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-heading text-lg leading-tight" style={{ color: '#d4c9b2' }}>
            {title}
          </span>
          {value && (
            <span className="font-mono text-xs" style={{ color: '#c97a12' }}>{value}</span>
          )}
        </span>
        <span
          className="shrink-0 font-mono text-lg transition-transform duration-200"
          style={{ color: '#6b8e23', transform: open ? 'rotate(45deg)' : 'none' }}
          aria-hidden="true"
        >
          +
        </span>
      </button>

      {/* Height is measured rather than fixed: these bodies range from one line
          to a wrapped contract address, and a single max-height big enough for
          the longest either clipped the rest or made every card animate at a
          different apparent speed.

          The measurement is held in state and taken in an effect. Reading
          `ref.current` during render is not allowed — refs are not populated on
          the server and are not a render input, and Next's build fails the page
          outright rather than letting it differ between server and client. */}
      <div
        id={`${id}-body`}
        style={{
          maxHeight: open ? `${bodyHeight ?? 600}px` : '0px',
          overflow: 'hidden',
          transition: 'max-height 260ms ease',
        }}
      >
        <div ref={bodyRef} className="px-5 pb-5 sm:px-6 sm:pb-6">
          <div className="font-body text-sm leading-relaxed" style={{ color: '#a0bb94' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
