/**
 * Draft queue.
 *
 * Shares the game's Postgres, in its own table. Reads of `GameSummary` are
 * strictly read-only: this bot must never be able to affect a game, so it holds
 * no write path to anything the backend owns.
 *
 * Unlike the support bot, failures here are NOT swallowed. That bot's job is to
 * keep answering users with the database down; this one's job is to not hand
 * you the same draft twice, and that guarantee lives entirely in this table. If
 * the store is unavailable the correct behaviour is to stop, not to carry on
 * without a record of what has already been drafted.
 */

import pg from 'pg'

export type DraftStatus = 'pending' | 'posted' | 'skipped'

export interface DraftRow {
  id: number
  kind: string
  templateId: string
  dedupeKey: string
  text: string
  status: DraftStatus
  createdAt: Date
}

let pool: pg.Pool

export async function initStore(databaseUrl: string): Promise<void> {
  pool = new pg.Pool({ connectionString: databaseUrl, max: 3 })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS x_drafts (
      id           BIGSERIAL PRIMARY KEY,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      kind         TEXT        NOT NULL,
      template_id  TEXT        NOT NULL DEFAULT '',
      dedupe_key   TEXT        NOT NULL UNIQUE,
      body         TEXT        NOT NULL,
      status       TEXT        NOT NULL DEFAULT 'pending',
      decided_at   TIMESTAMPTZ,
      decided_by   BIGINT
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS x_drafts_status_idx ON x_drafts (status, created_at DESC)`)

  console.log('[store] draft table ready')
}

/**
 * Queue a draft. Returns null when one already exists for this key, which is
 * the once-a-day guard: `dedupe_key` is the date, and it is unique, so a
 * restart or two overlapping ticks cannot produce a second draft for today.
 */
export async function enqueue(
  kind: string, templateId: string, dedupeKey: string, text: string,
): Promise<DraftRow | null> {
  const res = await pool.query(
    `INSERT INTO x_drafts (kind, template_id, dedupe_key, body) VALUES ($1, $2, $3, $4)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id, kind, template_id, dedupe_key, body, status, created_at`,
    [kind, templateId, dedupeKey, text],
  )
  if (res.rowCount === 0) return null
  return mapRow(res.rows[0])
}

/**
 * Template ids already used, oldest first.
 *
 * Feeds the least-recently-used rotation. Skipped drafts count: a line you
 * chose not to send is still one you have read, and showing it again the next
 * day is the same annoyance as repeating one you posted.
 */
export async function recentTemplateIds(limit = 30): Promise<string[]> {
  const res = await pool.query(
    `SELECT template_id FROM x_drafts
      WHERE template_id <> ''
      ORDER BY created_at DESC LIMIT $1`,
    [limit],
  )
  return res.rows.map(r => String(r.template_id)).reverse()
}

export async function getDraft(id: number): Promise<DraftRow | null> {
  const res = await pool.query(
    `SELECT id, kind, template_id, dedupe_key, body, status, created_at FROM x_drafts WHERE id = $1`,
    [id],
  )
  return res.rowCount === 0 ? null : mapRow(res.rows[0])
}

export async function updateBody(id: number, text: string): Promise<void> {
  await pool.query(`UPDATE x_drafts SET body = $2 WHERE id = $1`, [text, id])
}

/**
 * Record what you did with a draft.
 *
 * This is bookkeeping, not a lock. Nothing is published from here, so a double
 * tap costs nothing; the status exists so `/queue` can tell you what is still
 * waiting and so a draft you already used stops nagging.
 */
export async function setStatus(id: number, status: DraftStatus, decidedBy: number): Promise<void> {
  await pool.query(
    `UPDATE x_drafts SET status = $2, decided_at = now(), decided_by = $3 WHERE id = $1`,
    [id, status, decidedBy],
  )
}

export async function pendingDrafts(limit = 10): Promise<DraftRow[]> {
  const res = await pool.query(
    `SELECT id, kind, template_id, dedupe_key, body, status, created_at
       FROM x_drafts WHERE status = 'pending'
      ORDER BY created_at DESC LIMIT $1`,
    [limit],
  )
  return res.rows.map(mapRow)
}

/** Read-only handle for the game tables. */
export function query(sql: string, params: unknown[] = []) {
  return pool.query(sql, params)
}

function mapRow(r: Record<string, unknown>): DraftRow {
  return {
    id: Number(r.id),
    kind: String(r.kind),
    templateId: String(r.template_id ?? ''),
    dedupeKey: String(r.dedupe_key),
    text: String(r.body),
    status: r.status as DraftStatus,
    createdAt: r.created_at as Date,
  }
}
