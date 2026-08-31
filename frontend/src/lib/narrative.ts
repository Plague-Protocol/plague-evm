/**
 * narrative.ts — themed copy for the game's phase names and story beats.
 *
 * The palette themes in globals.css change how the game LOOKS. This changes
 * what it CALLS things, which is what actually makes a tenth game feel unlike
 * the first: "VOTING" and "THE JUDGEMENT" are the same mechanic wearing a
 * different face.
 *
 * Variants are PARTIAL OVERRIDES on BASE, deliberately. A theme declares only
 * the lines that genuinely change, so adding one is a handful of strings rather
 * than a full re-translation, and a line edited in BASE propagates everywhere it
 * was not intentionally overridden. Four independent copies of every string
 * would drift within a month.
 *
 * BASE is byte-identical to the copy that shipped before this file existed, so
 * the default theme reads exactly as it always has.
 */

import type { ThemeId } from './theme'

export type NarrativePhase = 'infection' | 'discussion' | 'voting' | 'reveal' | 'ended'
export type MomentId = 'infected' | 'shield'

export interface Moment {
  label: string
  sublabel: string
}

export interface NarrativeSet {
  phaseLabels: Record<NarrativePhase, string>
  /** Per-phase accent. Kept here rather than as CSS tokens because these are
   *  passed as props into PhaseTransition/MomentOverlay, which take hex. */
  phaseColors: Record<NarrativePhase, string>
  moments: Record<MomentId, Moment>
}

type NarrativeOverride = {
  phaseLabels?: Partial<Record<NarrativePhase, string>>
  phaseColors?: Partial<Record<NarrativePhase, string>>
  moments?: Partial<Record<MomentId, Partial<Moment>>>
}

const BASE: NarrativeSet = {
  phaseLabels: {
    infection:  'INFECTION',
    discussion: 'DISCUSS',
    voting:     'VOTING',
    reveal:     'ELIMINATION',
    ended:      'ENDED',
  },
  phaseColors: {
    infection:  '#e63329',
    discussion: '#6b8e23',
    voting:     '#f5c518',
    reveal:     '#d4c9b2',
    ended:      '#7d9a72',
  },
  moments: {
    infected: {
      label: 'You Are Infected',
      sublabel: 'Hide it. Spread it. Survive the votes.',
    },
    shield: {
      label: 'Shield Active',
      sublabel: 'innocence proven on-chain',
    },
  },
}

const OVERRIDES: Partial<Record<ThemeId, NarrativeOverride>> = {
  hallow: {
    phaseLabels: { infection: 'THE TURNING', reveal: 'THE RECKONING' },
    phaseColors: { discussion: '#d97706', voting: '#ffa41b' },
    moments: {
      infected: { label: 'The Rot Takes You', sublabel: 'Hide it. Spread it. Outlast the lanterns.' },
    },
  },
  redshift: {
    phaseLabels: { infection: 'CONTACT', discussion: 'TRANSMIT', reveal: 'PURGE' },
    phaseColors: { discussion: '#b45309', voting: '#22d3ee' },
    moments: {
      infected: { label: 'Contact Confirmed', sublabel: 'It is inside you now. Say nothing.' },
      shield: { label: 'Clean Scan', sublabel: 'innocence proven on-chain' },
    },
  },
  relic: {
    phaseLabels: {
      infection: 'THE WAKING',
      discussion: 'THE COUNCIL',
      voting: 'THE JUDGEMENT',
      reveal: 'THE OFFERING',
    },
    phaseColors: { discussion: '#2d8f7f', voting: '#5eead4', reveal: '#e8dcc0' },
    moments: {
      infected: { label: 'The Old Thing Stirs', sublabel: 'It wore others before you. Wear it well.' },
      shield: { label: 'Rite Observed', sublabel: 'innocence proven on-chain' },
    },
  },
}

/** Resolve the full copy set for a theme. Unknown themes fall back to BASE. */
export function narrativeFor(theme: ThemeId | null | undefined): NarrativeSet {
  const o = theme ? OVERRIDES[theme] : undefined
  if (!o) return BASE
  return {
    phaseLabels: { ...BASE.phaseLabels, ...o.phaseLabels },
    phaseColors: { ...BASE.phaseColors, ...o.phaseColors },
    moments: {
      infected: { ...BASE.moments.infected, ...o.moments?.infected },
      shield:   { ...BASE.moments.shield,   ...o.moments?.shield },
    },
  }
}
