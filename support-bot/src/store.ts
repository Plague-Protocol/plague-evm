/**
 * Ticket log.
 *
 * Two reasons this exists beyond day-to-day support: it is the evidence trail
 * behind the published 24-hour SLA, and support volume/resolution time is the
 * kind of operational data the Prezenti Anchor and Builder Fund rounds ask for.
 *
 * Every failure here is swallowed. A logging outage must never stop a user
 * reaching a human — the bot has to keep answering even with the database down.
 */

import pg from 'pg'

export interface Ticket {
  telegramUserId: number
  username?: string
  chatId: number
  messageId: number
  severity: string
  matched?: string
  txHash?: string
  address?: string
  text: string
}

let pool: pg.Pool | undefined
let ready = false

export async function initStore(databaseUrl?: string): Promise<void> {
  if (!databaseUrl) {
    console.warn('[store] DATABASE_URL unset — tickets will be logged to stdout only')
    return
  }
  try {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 3 })
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id             BIGSERIAL PRIMARY KEY,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        telegram_user  BIGINT      NOT NULL,
        username       TEXT,
        chat_id        BIGINT      NOT NULL,
        message_id     BIGINT      NOT NULL,
        severity       TEXT        NOT NULL,
        matched        TEXT,
        tx_hash        TEXT,
        wallet_address TEXT,
        body           TEXT        NOT NULL,
        resolved_at    TIMESTAMPTZ
      )
    `)
    await pool.query(
      `CREATE INDEX IF NOT EXISTS support_tickets_sev_idx ON support_tickets (severity, created_at DESC)`,
    )
    ready = true
    console.log('[store] ticket table ready')
  } catch (err) {
    console.error('[store] init failed, continuing without persistence:', err)
  }
}

export async function recordTicket(t: Ticket): Promise<number | undefined> {
  console.log(`[ticket] ${t.severity} from @${t.username ?? t.telegramUserId}: ${t.text.slice(0, 120)}`)
  if (!ready || !pool) return undefined
  try {
    const { rows } = await pool.query(
      `INSERT INTO support_tickets
         (telegram_user, username, chat_id, message_id, severity, matched, tx_hash, wallet_address, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [t.telegramUserId, t.username ?? null, t.chatId, t.messageId, t.severity,
       t.matched ?? null, t.txHash ?? null, t.address ?? null, t.text],
    )
    return rows[0]?.id as number
  } catch (err) {
    console.error('[store] insert failed:', err)
    return undefined
  }
}

export async function resolveTicket(id: number): Promise<boolean> {
  if (!ready || !pool) return false
  try {
    const r = await pool.query(
      `UPDATE support_tickets SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL`, [id])
    return (r.rowCount ?? 0) > 0
  } catch { return false }
}

/** Open P0/P1 counts — used by /stats so the SLA is checkable at a glance. */
export async function openCounts(): Promise<Record<string, number>> {
  if (!ready || !pool) return {}
  try {
    const { rows } = await pool.query(
      `SELECT severity, COUNT(*)::int AS n FROM support_tickets
        WHERE resolved_at IS NULL GROUP BY severity`)
    return Object.fromEntries(rows.map(r => [r.severity as string, r.n as number]))
  } catch { return {} }
}
