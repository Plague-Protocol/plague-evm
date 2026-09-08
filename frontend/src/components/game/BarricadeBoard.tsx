'use client'

/**
 * BarricadeBoard — the Discussion-phase minigame.
 *
 * Three times per round the horde pushes one station. You can hold your post,
 * move to another station, or (if you are infected) sabotage the one you are
 * standing at. Nobody is ever eliminated by this: it produces ARGUMENT, and the
 * vote stays the only thing that costs anyone money.
 *
 * 🚨 DOING NOTHING IS A MOVE.
 * The default is HOLD, pre-selected, and sending nothing is identical to
 * choosing it. That is what lets bots, third-party agents, players on a bad
 * mobile link, and players who are busy arguing in chat all sit in the same
 * large, unremarkable bucket — nobody can be identified by their silence. See
 * the header of backend/src/lib/barricade.ts for the full reasoning.
 *
 * 🚨 IT MUST NOT STEAL THE ROOM'S ATTENTION.
 * Chat is where the real game happens, so this is deliberately glanceable and
 * low-frequency: three decisions across ~180 s, each a single tap, with an 8 s
 * warning. No timing skill, no reflex, nothing that punishes a slow connection.
 * If it ever needs concentration, it is broken.
 *
 * 🚨 THIS PANEL IS CONTROLS AND EVIDENCE ONLY — the SITUATION lives in the
 * quarantine cam. It originally drew its own picture of the room, which put two
 * disagreeing pictures on screen at once: the cam showed figures wandering an
 * open chamber while this insisted you were posted at a window. Play-testing
 * found it immediately, and it also made the rules illegible, because a panel
 * has to explain what a picture can just show. So the cam took the geometry and
 * this kept the two things a picture cannot do — letting you choose, and listing
 * what was learned. Do not re-add a board diagram here.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { STATIONS, type BarricadeAction, type BarricadeState, type StationId } from '@/lib/barricade'

export interface BarricadeBoardProps {
  readonly state: BarricadeState | null
  /** The local player's post this round, or null when they are not playing. */
  readonly myStation: StationId | null
  /** Where the local player currently intends to be. */
  readonly myChoice: BarricadeAction
  /** Only infected players may sabotage; the control is hidden otherwise. */
  readonly canSabotage: boolean
  readonly disabled: boolean
  /** Resolves an exposed address to the same name the player cards show. */
  readonly nameOf: (address: string) => string
  readonly onChoose: (action: BarricadeAction) => void
}

const TOXIC = '#6b8e23'
const ALARM = '#e63329'
const BONE  = '#d4c9b2'
const MOSS  = '#7d9a72'

/** Where the player will actually be standing, given their choice. */
function standingAt(myStation: StationId | null, choice: BarricadeAction): StationId | null {
  if (myStation === null) return null
  return choice.kind === 'move' ? choice.station : myStation
}

export function BarricadeBoard({
  state, myStation, myChoice, canSabotage, disabled, nameOf, onChoose,
}: BarricadeBoardProps) {
  const reduced = useReducedMotion()
  const [now, setNow] = useState(() => Date.now())

  // The countdown is animated locally off a single timestamp the server sent —
  // it is never ticked over the wire. One second of resolution is plenty for an
  // 8 s warning, and it keeps this off the egress budget entirely.
  useEffect(() => {
    if (!state?.next) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [state?.next])

  if (!state) return null

  const here = standingAt(myStation, myChoice)
  const incoming = state.next
  const secsLeft = incoming ? Math.max(0, Math.ceil((incoming.at - now) / 1000)) : 0
  const inDanger = incoming !== null && here === incoming.station

  return (
    <section
      className="rounded-lg border p-3"
      style={{ borderColor: 'rgba(107,142,35,0.3)', backgroundColor: 'rgba(107,142,35,0.04)' }}
      aria-label="Barricade"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-heading text-sm uppercase tracking-[0.18em]" style={{ color: BONE }}>
          The Barricade
        </h3>
        {/* The night's condition. Named rather than numbered so it reads as
            weather closing in, not as a difficulty setting you picked. */}
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: MOSS }}>
          <span style={{ color: state.threshold > 2 ? ALARM : MOSS }}>{state.level}</span>
          {' · '}{state.outcomes.length}/{state.pushes}
        </span>
      </header>

      {/* Warning — the only urgent thing on the panel, and only for 8 seconds. */}
      <AnimatePresence>
        {incoming && (
          <motion.p
            key={`warn-${incoming.push}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="mt-2 font-mono text-[11px] leading-snug"
            style={{ color: inDanger ? ALARM : BONE }}
          >
            ⚠ <b>{STATIONS[incoming.station]}</b> is buckling — {secsLeft}s
            {inDanger && <span style={{ color: ALARM }}> · you are there</span>}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Controls. Deliberately a row of labelled buttons rather than a diagram:
          the cam above is already showing where everyone is standing, and a
          second, smaller, less accurate picture beside it only invites the eye
          to check whether they agree. */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {STATIONS.map((label, i) => {
          const station = i as StationId
          const isHere = here === station
          const isTarget = incoming?.station === station
          return (
            <button
              key={label}
              type="button"
              disabled={disabled || myStation === null}
              onClick={() => onChoose(station === myStation ? { kind: 'hold' } : { kind: 'move', station })}
              className="rounded border px-2 py-2 font-mono text-[10px] uppercase leading-tight tracking-wider transition-opacity disabled:opacity-40"
              style={{
                borderColor: isHere ? TOXIC : 'rgba(107,142,35,0.25)',
                backgroundColor: isHere ? 'rgba(107,142,35,0.15)' : 'transparent',
                color: isHere ? BONE : MOSS,
                boxShadow: isTarget ? `0 0 0 1px ${ALARM}` : undefined,
              }}
            >
              {label}
              {station === myStation && (
                <span className="mt-0.5 block text-[9px] normal-case" style={{ color: MOSS }}>your post</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Sabotage. Shown only to the infected, and never announced when used. */}
      {canSabotage && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChoose(myChoice.kind === 'sabotage' ? { kind: 'hold' } : { kind: 'sabotage' })}
          className="mt-2 w-full rounded border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-opacity disabled:opacity-40"
          style={{
            borderColor: myChoice.kind === 'sabotage' ? ALARM : 'rgba(230,51,41,0.35)',
            backgroundColor: myChoice.kind === 'sabotage' ? 'rgba(230,51,41,0.15)' : 'transparent',
            color: myChoice.kind === 'sabotage' ? '#ff6b6b' : 'rgba(230,51,41,0.75)',
          }}
        >
          ☣ {myChoice.kind === 'sabotage' ? 'Sabotaging this station' : 'Sabotage this station'}
        </button>
      )}

      {myStation === null ? (
        <p className="mt-2 font-mono text-[10px]" style={{ color: MOSS }}>
          You are not on the barricade this round.
        </p>
      ) : (
        <p className="mt-2 font-mono text-[10px] leading-snug" style={{ color: MOSS }}>
          Watch the cam — you are the figure marked YOU. Holding your post is a
          normal play and most of the room does it. A station needs{' '}
          <b style={{ color: BONE }}>{state.threshold}</b> bodies to hold.
        </p>
      )}

      {/* The evidence log. A station that holds reports a count and no names;
          a station that breaks names everyone who was standing there, innocent
          or not — which is the argument this whole thing exists to start. */}
      {state.outcomes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t pt-2" style={{ borderColor: 'rgba(107,142,35,0.18)' }}>
          {state.outcomes.map(o => (
            <li key={o.push} className="font-mono text-[10px] leading-snug break-words" style={{ color: MOSS }}>
              <span style={{ color: o.held ? TOXIC : ALARM }}>
                {o.held ? '✔' : '✘'} {STATIONS[o.station]} {o.held ? 'held' : 'BROKE'}
              </span>
              {' · '}{o.present} present
              {!o.held && o.exposed.length > 0 && (
                <span style={{ color: BONE }}>
                  {' — '}{o.exposed.map(nameOf).join(', ')} {o.exposed.length === 1 ? 'was' : 'were'} there
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
