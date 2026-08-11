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
 * - **Email** (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`OPS_ALERT_EMAIL_TO`).
 *
 * ⚠️ Telegram is the one to trust. Mail sent from a bare VPS IP to Gmail
 * frequently lands in spam or is rejected outright, and it will do that exactly
 * when it matters. Treat email as the audit trail and Telegram as the page.
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

const SMTP_HOST = process.env.SMTP_HOST ?? ''
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587)
const SMTP_USER = process.env.SMTP_USER ?? ''
const SMTP_PASS = process.env.SMTP_PASS ?? ''
const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER
const EMAIL_TO = (process.env.OPS_ALERT_EMAIL_TO ?? '')
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
    email: Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS) && EMAIL_TO.length > 0,
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
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || EMAIL_TO.length === 0) return
  try {
    // Imported lazily so a backend with no SMTP configured never pays for the
    // module, and a missing/broken nodemailer install cannot break boot.
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
    await transport.sendMail({ from: SMTP_FROM, to: EMAIL_TO.join(','), subject, text })
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
