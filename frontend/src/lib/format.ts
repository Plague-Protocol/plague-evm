/**
 * Display helpers for token amounts (18-decimal wei).
 */

/**
 * Format an 18-decimal wei amount for display, choosing a sensible number of
 * decimals so small stakes/pots don't collapse to "0.00":
 *   - >= 1      → up to 2 decimals   (e.g. 12.5, 100)
 *   - < 1       → up to 6 decimals   (e.g. 0.0001, 0.0005)
 * Trailing zeros are trimmed, and a nonzero amount never renders as "0".
 */
export function formatToken(wei: bigint | number | string): string {
  const v = Number(wei) / 1e18
  if (!Number.isFinite(v) || v === 0) return '0'

  const decimals = Math.abs(v) >= 1 ? 2 : 6
  const trimmed = v.toFixed(decimals).replace(/\.?0+$/, '')

  // Guard against an extremely small positive value rounding away entirely.
  if (trimmed === '0' || trimmed === '-0') return v > 0 ? '<0.000001' : '0'
  return trimmed
}
