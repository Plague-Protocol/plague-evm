/**
 * Operational alerting — Telegram and/or email, both optional.
 *
 * Written after a 100-hour outage that nobody was told about: the backend
 * signer ran out of CELO, every backend-authorized phase transition began
 * failing, and six rooms froze while the service kept reporting healthy on
 * `/health`. The failure was visible in the logs the whole time. Nobody was
 * reading the logs. So the lesson encoded here is that a warning nobody
 * receives is not a warning.
 *
 * Two delivery channels, independently gated so neither can block the other:
 *
 * - **Telegram** (`TELEGRAM_BOT_TOKEN` + `OPS_ALERT_TELEGRAM_IDS`) — reuses the
 *   existing support bot's token. Called over plain `fetch` rather than pulling
 *   grammY into the backend; this is two endpoints, not a framework.
 * - **Email** (`RESEND_API_KEY` + `ALERT_EMAIL`) — Resend's HTTP API, also over
 *   plain `fetch`, which is why this file has no mail dependency at all.
 *
 * Resend rather than raw SMTP specifically because mail sent from a bare VPS IP
 * to Gmail is frequently spam-foldered or rejected outright — and it would do
 * that exactly when an alert matters. Resend sends from its own warmed
 * infrastructure, which removes that failure mode.
 *
 * ⚠️ `ALERT_EMAIL_FROM` defaults to `onboarding@resend.dev`, Resend's shared
 * sender. On an unverified account that address can ONLY deliver to the address
 * that owns the Resend account — fine for a single operator, silently useless
 * the moment you add a second recipient. Verify zplague.xyz in the Resend
 * dashboard and set a real from-address before relying on it more widely.
 *
 * Every send is wrapped: an alerting failure must never take down the caller.
 * The whole point is that this runs inside the monitors that keep games moving.
 */
import { logger } from '../lib/logger'

export type Severity = 'critical' | 'warning' | 'info'

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_IDS = (process.env.OPS_ALERT_TELEGRAM_IDS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
const EMAIL_FROM = process.env.ALERT_EMAIL_FROM ?? 'onboarding@resend.dev'
const EMAIL_TO = (process.env.ALERT_EMAIL ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const ICON: Record<Severity, string> = {
  critical: '🚨',
  warning: '⚠️',
  info: 'ℹ️',
}

export function alertingConfigured(): { telegram: boolean; email: boolean } {
  return {
    telegram: Boolean(TELEGRAM_TOKEN) && TELEGRAM_IDS.length > 0,
    email: Boolean(RESEND_API_KEY) && EMAIL_TO.length > 0,
  }
}

async function sendTelegram(text: string): Promise<void> {
  if (!TELEGRAM_TOKEN || TELEGRAM_IDS.length === 0) return
  for (const chatId of TELEGRAM_IDS) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      })
      if (!res.ok) {
        // A 403 here almost always means the operator never pressed /start in a
        // DM with the bot — Telegram refuses to deliver to strangers. Say so,
        // because the generic body is not obvious about it.
        logger.warn(`[alerts] telegram ${chatId} rejected: ${res.status} ${await res.text()}`)
      }
    } catch (err) {
      logger.warn(`[alerts] telegram ${chatId} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function sendEmail(subject: string, text: string): Promise<void> {
  if (!RESEND_API_KEY || EMAIL_TO.length === 0) return
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: EMAIL_TO, subject, text }),
    })
    if (!res.ok) {
      // 403 with "You can only send testing emails to your own email address"
      // means the from-address is still onboarding@resend.dev on an unverified
      // account. Verify a domain and set ALERT_EMAIL_FROM. Logged in full
      // because Resend's message is the useful part.
      logger.warn(`[alerts] resend rejected: ${res.status} ${await res.text()}`)
    }
  } catch (err) {
    logger.warn(`[alerts] email failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Fire an alert on every configured channel. Never throws.
 *
 * `key` is for the caller's own de-duplication bookkeeping (see opsWatchdog) —
 * this function delivers unconditionally, so callers must not call it on a
 * timer without their own cooldown.
 */
export async function sendAlert(opts: {
  key: string
  severity: Severity
  title: string
  lines?: string[]
}): Promise<void> {
  const { key, severity, title, lines = [] } = opts
  const body = [`${ICON[severity]} ${title}`, ...lines].join('\n')

  const level = severity === 'critical' ? 'error' : 'warn'
  logger[level](`[alerts] ${key}: ${title}${lines.length ? ` | ${lines.join(' | ')}` : ''}`)

  await Promise.allSettled([
    sendTelegram(body),
    sendEmail(`[Zombie Plague] ${title}`, body),
  ])
}
