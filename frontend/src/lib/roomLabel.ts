/**
 * Room display labels.
 *
 * The on-chain room id is a plain incrementing counter, so showing it raw
 * ("Room #87") leaks how many rooms have ever been created. Instead we derive a
 * deterministic, non-sequential "quarantine ward" code from the id for the
 * fallback label. Custom room names (stored off-chain) always take precedence.
 *
 * Shared by the lobby and game pages so the SAME id always renders the SAME
 * ward everywhere — deriving it in two places risks drift and a room showing
 * two different names.
 */

/** Deterministic, non-sequential ward code, e.g. `Ward K-49`. */
export function quarantineCode(id: bigint): string {
  const h = Number((id * 2654435761n) % 2147483647n) // Knuth multiplicative hash
  const letter = String.fromCharCode(65 + (h % 26))   // A–Z
  const num = (Math.floor(h / 26) % 99) + 1            // 1–99
  return `Ward ${letter}-${num}`
}

/** Custom name if set, else the derived ward code. */
export function roomLabel(room: { id: bigint; name?: string | null }): string {
  return room.name ? room.name : quarantineCode(room.id)
}
