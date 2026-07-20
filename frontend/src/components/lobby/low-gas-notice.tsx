'use client'

import { formatToken } from '@/lib/format'

/**
 * Warns a wallet that is short on native CELO for gas.
 *
 * Rendered twice on the lobby with different `variant`s (a page-level banner
 * above the fold, and the detail card inside the wallet panel) so both read
 * from one source of copy. The blocking toast in the create/join pre-flight
 * quotes the same figures — a player must never be told "a little CELO" in one
 * place and a hard number in another.
 *
 * Both amounts are derived, never literals: `requiredWei` comes from the same
 * constant the pre-flight gate compares against, so retuning the threshold
 * updates this copy automatically.
 *
 * `hasStable` gates the stake sentence: this notice is derived purely from the
 * NATIVE balance, so it must not assert anything about the player's USDm unless
 * that balance is actually known. `null` (still loading / read failed) says
 * nothing about USDm at all.
 */
export function LowGasNotice({
  stableToken,
  hasStable,
  celoBalanceWei,
  requiredWei,
  variant = 'card',
}: {
  stableToken: string
  hasStable: boolean | null
  celoBalanceWei: bigint | null
  requiredWei: bigint
  variant?: 'card' | 'banner'
}) {
  const gold = { color: '#f5c518' }

  return (
    <div
      className={
        variant === 'banner'
          ? 'flex flex-col gap-1 rounded-lg border px-4 py-3 sm:flex-row sm:items-baseline sm:gap-3'
          : 'rounded border px-3 py-2'
      }
      style={{ borderColor: 'rgba(245,197,24,0.3)', backgroundColor: 'rgba(245,197,24,0.06)' }}
      role="status"
    >
      <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em]" style={gold}>
        ⛽ Low on CELO
      </p>
      <p
        className={
          variant === 'banner'
            ? 'font-mono text-[11px] leading-relaxed sm:text-xs'
            : 'mt-1 font-mono text-[11px] leading-relaxed'
        }
        style={{ color: '#d9c47a' }}
      >
        {celoBalanceWei === null ? (
          <>This wallet is low on <span style={gold}>CELO</span>. </>
        ) : (
          <>
            This wallet holds <span style={gold}>{formatToken(celoBalanceWei)} CELO</span>.{' '}
          </>
        )}
        A full game costs about <span style={gold}>{formatToken(requiredWei)} CELO</span> in gas
        fees, mostly the one-time proof submitted when the game starts.
        {hasStable === false && <> You’ll also need {stableToken} to stake.</>} Top up this wallet,
        or use <span style={gold}>MiniPay</span> to pay fees in {stableToken} instead.
      </p>
    </div>
  )
}
