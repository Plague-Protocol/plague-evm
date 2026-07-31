/**
 * Support endpoints surfaced inside the app.
 *
 * MiniPay's gateway rules require a support channel reachable from within the
 * app itself, and email alone does not satisfy that — they expect somewhere a
 * user gets a human in a reasonable time. The Telegram group is the primary
 * channel; email stays as the fallback for anything that needs a paper trail.
 *
 * `SUPPORT_TELEGRAM_READY` still gates rendering: if this URL is ever reset to a
 * placeholder, the link is hidden rather than shipped broken, since a dead
 * support link reads worse to a reviewer than no link at all.
 */
export const SUPPORT_TELEGRAM_URL = 'https://t.me/zplague_xyz'

export const SUPPORT_EMAIL = 'support@zplague.xyz'

/** False if the Telegram URL is ever reset to an unedited placeholder. */
export const SUPPORT_TELEGRAM_READY =
  !SUPPORT_TELEGRAM_URL.includes('REPLACE_ME') && SUPPORT_TELEGRAM_URL.startsWith('https://t.me/')

/**
 * Response commitment published to users. MiniPay requires a stated SLA for
 * critical/breaking issues to keep a store listing; stating it in the UI (not
 * just in a grant email) is what makes it verifiable.
 */
export const SUPPORT_SLA_HOURS = 24
