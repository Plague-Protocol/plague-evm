/**
 * Ops watchdog — catches the class of failure that froze mainnet for 100 hours.
 *
 * On 2026-08-11 the backend signer ran out of CELO. Every backend-authorized
 * phase transition (beginActivePhase / assignInfection / openVoting /
 * finalizeElimination) started reverting, six rooms froze mid-game, and the
 * lobby filled with games that looked live and were not. `/health` returned 200
 * the entire time, because the HTTP server was perfectly fine — it was the
 * signer that was broke.
 *
 * The specific bug that trapped one of those rooms is fixed in
 * `handleInfectionPhase`. This file is the general answer to "what if it happens
 * again for a reason we haven't thought of yet": rather than enumerate causes,
 * watch the two symptoms that any cause must produce.
 *
 *   1. **Gas below a floor** — the leading indicator. Alerts while games still
 *      work, which is the whole point: you top up before anything freezes.
 *   2. **A room whose phase has not advanced** — the trailing indicator, and
 *      deliberately cause-agnostic. RPC outage, nonce gap, contract dead-end,
 *      a bug not yet written: all of them show up here as a phase clock that
 *      stopped moving.
 *
 * Plus room-slot exhaustion, because a permanently stuck room holds its slot
 * forever and `maxActiveRooms` blocks new games for *humans* when it fills.
 *
 * Every check is independent and wrapped — the watchdog must never be the
 * reason the service goes down.
 */
import { chainAdapter } from './chainAdapter'
import { sendAlert, alertingConfigured } from './alerts'
import { logger } from '../lib/logger'

const CHECK_INTERVAL_MS = Number(process.env.OPS_WATCHDOG_INTERVAL_MS ?? 5 * 60_000)

/** Warn below this native CELO balance. Default 2 CELO ≈ 4 ZK role commits at
 *  the observed ~0.42 CELO each, so there is real runway left to act on. */
const MIN_SIGNER_WEI = BigInt(process.env.OPS_MIN_SIGNER_WEI ?? 2_000_000_000_000_000_000n)

/** A room whose phase clock has not moved in this long is stuck. The longest
 *  configured phase in practice is ~180s, so 15 min is ~5× headroom and will
 *  not fire on a merely slow round. */
const ROOM_STALL_MS = Number(process.env.OPS_ROOM_STALL_MS ?? 15 * 60_000)

/** Re-alert on a still-unresolved issue only this often. Default 6h — enough to
 *  keep nagging about a real outage without becoming noise you learn to ignore. */
const COOLDOWN_MS = Number(process.env.OPS_ALERT_COOLDOWN_MS ?? 6 * 60 * 60_000)

/** Extra addresses to watch for low gas — bot wallets pay their own gas, and a
 *  benched bot pool is a quieter but equally real outage. Comma-separated. */
const EXTRA_WATCHED = (process.env.OPS_WATCH_ADDRESSES ?? '')
  .split(',')
  .map(s => s.trim())
  .filter((s): s is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(s))

/** key → last time we alerted. Absence means "healthy", which is what lets us
 *  send a recovery notice exactly once on the transition back. */
const lastAlertedAt = new Map<string, number>()

function shouldAlert(key: string, now: number): boolean {
  const last = lastAlertedAt.get(key)
  if (last === undefined) return true
  return now - last >= COOLDOWN_MS
}

function markAlerted(key: string, now: number): void {
  lastAlertedAt.set(key, now)
}

/** Fire a one-shot "it's better now" if this key had been alerting. */
async function markResolved(key: string, title: string): Promise<void> {
  if (!lastAlertedAt.has(key)) return
  lastAlertedAt.delete(key)
  await sendAlert({ key: `${key}:resolved`, severity: 'info', title })
}

function celo(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(3)
}

async function checkGas(now: number): Promise<void> {
  const signer = chainAdapter.getSignerAddress()
  const watched: { label: string; addr: `0x${string}` }[] = [
    { label: 'backend signer', addr: signer },
    ...EXTRA_WATCHED.map((addr, i) => ({ label: `watched wallet ${i + 1}`, addr })),
  ]

  for (const { label, addr } of watched) {
    const key = `gas:${addr.toLowerCase()}`
    try {
      const balance = await chainAdapter.getNativeBalance(addr)
      if (balance >= MIN_SIGNER_WEI) {
        await markResolved(key, `${label} gas recovered — ${celo(balance)} CELO`)
        continue
      }
      if (!shouldAlert(key, now)) continue
      markAlerted(key, now)
      await sendAlert({
        key,
        severity: balance === 0n ? 'critical' : 'warning',
        title: `${label} low on gas — ${celo(balance)} CELO`,
        lines: [
          `Address: ${addr}`,
          `Floor:   ${celo(MIN_SIGNER_WEI)} CELO`,
          '',
          'Gas is paid in native CELO, not USDm. If this reaches zero every',
          'backend phase transition reverts and live games freeze mid-round.',
        ],
      })
    } catch (err) {
      logger.warn(`[ops-watchdog] gas check failed for ${addr}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function checkStalledRooms(liveRoomIds: bigint[], now: number): Promise<void> {
  for (const id of liveRoomIds) {
    const key = `room-stalled:${id}`
    try {
      const room = await chainAdapter.getRoom(id)
      // Only Active rooms have a meaningful phase clock. Waiting rooms are
      // supposed to sit idle until someone joins or they expire.
      if (Number(room.status) !== 2) {
        await markResolved(key, `Room ${id} is moving again`)
        continue
      }
      const phaseStartedAt = Number(room.phaseStartedAt) * 1000
      // phaseStartedAt of 0 means the phase clock was never set — treat as
      // unknown rather than "stuck since 1970".
      if (phaseStartedAt <= 0) continue
      const stalledMs = now - phaseStartedAt
      if (stalledMs < ROOM_STALL_MS) {
        await markResolved(key, `Room ${id} is moving again`)
        continue
      }
      if (!shouldAlert(key, now)) continue
      markAlerted(key, now)
      const phases = ['Infection', 'Discussion', 'Voting', 'Reveal', 'Ended']
      await sendAlert({
        key,
        severity: 'critical',
        title: `Room ${id} stuck for ${(stalledMs / 3_600_000).toFixed(1)}h`,
        lines: [
          `Round ${room.currentRound}, phase ${phases[Number(room.currentPhase)] ?? room.currentPhase}`,
          `Players: ${room.players.length}, pot ${celo(room.pot)} USDm`,
          '',
          'Check backend gas first, then `docker compose logs backend | grep',
          'phase-advance-monitor`. Runbook: docs/TROUBLESHOOTING.md section 1.',
        ],
      })
    } catch (err) {
      logger.warn(`[ops-watchdog] room check failed for ${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function checkRoomCapacity(now: number): Promise<void> {
  const key = 'room-slots'
  try {
    const [active, max] = await Promise.all([
      chainAdapter.getActiveRoomCount(),
      chainAdapter.getMaxActiveRooms(),
    ])
    // Warn with 2 slots to spare — at zero, room creation reverts for humans
    // too, and that is a full outage rather than a warning.
    if (max === 0n || active + 2n < max) {
      await markResolved(key, `Room slots healthy again — ${active}/${max}`)
      return
    }
    if (!shouldAlert(key, now)) return
    markAlerted(key, now)
    await sendAlert({
      key,
      severity: active >= max ? 'critical' : 'warning',
      title: `Room slots nearly exhausted — ${active}/${max} in use`,
      lines: [
        'activeRoomCount only decrements when a room ENDS, so a permanently',
        'stuck room holds its slot forever. At the cap, createRoom reverts for',
        'everyone including human players.',
        '',
        'Clear stuck rooms, or raise the ceiling with setMaxActiveRooms(admin).',
      ],
    })
  } catch (err) {
    logger.warn(`[ops-watchdog] capacity check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Start the watchdog. `getLiveRoomIds` is injected rather than imported so this
 * module stays free of the socket layer (and of a require cycle with it).
 */
export function startOpsWatchdog(
  getLiveRoomIds: () => bigint[],
  intervalMs = CHECK_INTERVAL_MS,
): NodeJS.Timeout {
  const configured = alertingConfigured()
  if (!configured.telegram && !configured.email) {
    // Deliberately loud. A watchdog with no delivery channel is theatre, and
    // the whole incident it exists to prevent was "the warning went nowhere".
    logger.warn(
      '[ops-watchdog] running with NO alert channel configured — set ' +
      'TELEGRAM_BOT_TOKEN + OPS_ALERT_TELEGRAM_IDS and/or SMTP_* + ' +
      'OPS_ALERT_EMAIL_TO, or alerts will only reach the logs nobody reads',
    )
  } else {
    logger.info(
      `[ops-watchdog] started — telegram=${configured.telegram} email=${configured.email} ` +
      `interval=${Math.round(intervalMs / 1000)}s gasFloor=${celo(MIN_SIGNER_WEI)}CELO ` +
      `stallAfter=${Math.round(ROOM_STALL_MS / 60_000)}m`,
    )
  }

  let inProgress = false
  return setInterval(async () => {
    if (inProgress) return
    inProgress = true
    try {
      const now = Date.now()
      // Independent, so one failing check never suppresses the others.
      await Promise.allSettled([
        checkGas(now),
        checkStalledRooms(getLiveRoomIds(), now),
        checkRoomCapacity(now),
      ])
    } finally {
      inProgress = false
    }
  }, intervalMs)
}
