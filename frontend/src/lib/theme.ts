/**
 * theme.ts — the theme registry and the rules for picking one.
 *
 * A theme is only a palette swap (see the [data-theme] blocks in globals.css),
 * so adding one is data, not code. Resolution order:
 *
 *   1. an explicit player choice, if they made one
 *   2. the scheduled theme for today, if any
 *   3. 'outbreak', the default
 *
 * Scheduling is derived from the date rather than driven by a cron or a stored
 * flag: a seasonal theme that depends on a job having run is a theme that
 * silently fails to arrive on the one day it mattered.
 */

export type ThemeId = 'outbreak' | 'hallow' | 'redshift' | 'relic'

export interface ThemeDef {
  id: ThemeId
  /** Shown in the picker. */
  name: string
  /** One line of in-world framing, not a description of the colours. */
  blurb: string
  /**
   * Inclusive UTC window this theme takes over, as [MM-DD, MM-DD]. Windows may
   * wrap the year end. Omit for themes that are only ever chosen manually.
   */
  window?: readonly [string, string]
}

export const THEMES: readonly ThemeDef[] = [
  {
    id: 'outbreak',
    name: 'Outbreak',
    blurb: 'Ground zero. Bio-hazard green and old bone.',
  },
  {
    id: 'hallow',
    name: 'Hallow',
    blurb: 'Late October. The lights go orange and nobody trusts anybody.',
    window: ['10-24', '11-02'],
  },
  {
    id: 'redshift',
    name: 'Redshift',
    blurb: 'The strain did not start here. Oxide dust and a colder light.',
  },
  {
    id: 'relic',
    name: 'Relic',
    blurb: 'Something old, dug up and still breathing. Bronze and verdigris.',
  },
] as const

export const DEFAULT_THEME: ThemeId = 'outbreak'
export const THEME_STORAGE_KEY = 'plague_theme_v1'
/** Stored value meaning "follow the calendar". */
export const THEME_AUTO = 'auto'

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some(t => t.id === v)
}

/** MM-DD in UTC, so the window is the same instant for every player. */
function monthDay(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function inWindow(today: string, [from, to]: readonly [string, string]): boolean {
  // A window that wraps the year end (e.g. 12-28 → 01-03) is two ranges.
  return from <= to ? today >= from && today <= to : today >= from || today <= to
}

/** The theme the calendar asks for today, or the default. */
export function scheduledTheme(now: Date = new Date()): ThemeId {
  const today = monthDay(now)
  for (const t of THEMES) {
    if (t.window && inWindow(today, t.window)) return t.id
  }
  return DEFAULT_THEME
}

/**
 * Resolve the theme to apply. `stored` is the raw localStorage value: a theme
 * id pins that theme, THEME_AUTO or anything unrecognised follows the calendar.
 */
export function resolveTheme(stored: string | null, now: Date = new Date()): ThemeId {
  if (isThemeId(stored)) return stored
  return scheduledTheme(now)
}

/**
 * The script inlined in <head> to set data-theme before first paint. Without it
 * the page renders in the default palette and repaints once React hydrates,
 * which reads as a flash of the wrong season.
 *
 * Deliberately dependency-free and duplicated from the logic above — it has to
 * run before any module loads. Keep the two in step; the window list is the
 * only thing that ever changes.
 */
export const THEME_BOOT_SCRIPT = `
(function(){
  try {
    var W = ${JSON.stringify(THEMES.filter(t => t.window).map(t => [t.id, ...t.window!]))};
    var s = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var ok = ${JSON.stringify(THEMES.map(t => t.id))};
    var t = ok.indexOf(s) > -1 ? s : null;
    if (!t) {
      var d = new Date();
      var md = ('0'+(d.getUTCMonth()+1)).slice(-2)+'-'+('0'+d.getUTCDate()).slice(-2);
      for (var i=0;i<W.length;i++){
        var id=W[i][0], f=W[i][1], u=W[i][2];
        if (f<=u ? (md>=f&&md<=u) : (md>=f||md<=u)) { t=id; break; }
      }
    }
    if (t && t !== ${JSON.stringify(DEFAULT_THEME)}) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
`.trim()
