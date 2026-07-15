/**
 * chainAdapter.ts
 *
 * Celo EVM chain adapter for the Plague Protocol backend.
 * viem-based chain adapter for Celo EVM.
 *
 * Responsibilities:
 *  - Wraps viem public + wallet clients for the game contract
 *  - Exposes backend-only write calls (createRoom, assignInfection,
 *    beginActivePhase, openVoting) signed by the BACKEND_SIGNER key
 *  - Exposes read calls used by REST routes and the socket handler
 *  - Provides watchContractEvent helpers for the socket handler to
 *    forward on-chain events to connected clients
 *
 * Environment variables (set in .env):
 *   CELO_RPC_URL        RPC endpoint (default: Celo Sepolia public)
 *   CELO_RPC_FALLBACK_URLS Optional comma-separated fallback RPC URLs
 *   CONTRACT_ADDRESS    Deployed PlagueGame address
 *   BACKEND_PRIVATE_KEY Hex private key for the backend signer wallet
 *   NETWORK             "testnet" | "mainnet"  (default: "testnet")
 */

import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celoSepolia, celo } from 'viem/chains'
import { logger } from '../lib/logger'

type RpcHealthState = {
  healthy: boolean
  lastLogAt: number
  lastError: string
}

const rpcHealthState = new Map<string, RpcHealthState>()
const LOG_RATE_LIMIT_MS = 60_000

function shouldLogRpc(url: string, healthy: boolean, errorMessage = ''): boolean {
  const prev = rpcHealthState.get(url)
  const now = Date.now()
  if (!prev) {
    rpcHealthState.set(url, { healthy, lastLogAt: now, lastError: errorMessage })
    return true
  }
  const statusChanged = prev.healthy !== healthy
  const windowElapsed = now - prev.lastLogAt >= LOG_RATE_LIMIT_MS
  if (statusChanged || windowElapsed) {
    rpcHealthState.set(url, { healthy, lastLogAt: now, lastError: errorMessage })
    return true
  }
  return false
}

async function probeRpc(url: string, timeoutMs: number): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now()
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: controller.signal,
    })
    const latencyMs = Date.now() - startedAt
    if (!response.ok) {
      return { ok: false, latencyMs, error: `HTTP ${response.status}` }
    }
    const json = await response.json() as { result?: string; error?: { message?: string } }
    if (typeof json.result === 'string') return { ok: true, latencyMs }
    return { ok: false, latencyMs, error: json.error?.message ?? 'Invalid JSON-RPC response' }
  } catch (err) {
    const latencyMs = Date.now() - startedAt
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, latencyMs, error: msg }
  } finally {
    clearTimeout(id)
  }
}

// ── ABI (subset used by the backend) ─────────────────────────────────────────

const PLAGUE_ABI = parseAbi([
  // Backend-only writes
  'function createRoom(uint32 maxPlayers, uint256 stakeAmount, uint256 proofFee, uint64 expirySecs) external returns (uint256)',
  'function beginActivePhase(uint256 roomId) external',
  'function eliminateUncommittedPlayers(uint256 roomId) external',
  'function finalizeStartTimeout(uint256 roomId) external',
  'function assignInfection(uint256 roomId, address target) external',
  'function openVoting(uint256 roomId) external',
  'function resolveRound(uint256 roomId) external',
  'function finalizeElimination(uint256 roomId) external',
  'function expireRoom(uint256 roomId) external',
  // Reads
  'function getRoom(uint256 roomId) external view returns ((uint256 id, address host, uint8 status, (uint32 minPlayers, uint32 maxPlayers, uint256 stakeAmount, uint32 maxRounds, uint64 roundDurationSecs, uint64 discussionDurationSecs, uint64 votingDurationSecs, uint64 expirySecs, uint256 proofFee) config, address[] players, uint32 currentRound, uint8 currentPhase, uint256 pot, uint64 createdAt, uint64 expiresAt, uint64 startedAt, uint64 phaseStartedAt))',
  'function getPlayer(uint256 roomId, address player) external view returns ((address addr, uint8 status, bytes32 roleCommitment, uint256 staked, address voteTarget, uint64 joinedAt, bool freeProofUsed, uint32 proofsSubmittedTotal, bool pendingInfectionNextRound, bool hasProofThisRound, bool hasVotedThisRound, bool roleCommitted))',
  'function currentPatientZero(uint256 roomId) external view returns (address)',
  'function roomCount() external view returns (uint256)',
  // Events
  'event PlayerJoined(uint256 indexed roomId, address player)',
  'event GameStarted(uint256 indexed roomId)',
  'event RoundStarted(uint256 indexed roomId, uint32 round)',
  'event PhaseChanged(uint256 indexed roomId, uint8 phase)',
  'event VoteCast(uint256 indexed roomId, address voter, address target)',
  'event ProofSubmitted(uint256 indexed roomId, address player)',
  'event PlayerEliminated(uint256 indexed roomId, address player)',
  'event PlayerSavedByProof(uint256 indexed roomId, address player)',
  'event VoteResolved(uint256 indexed roomId, string message)',
  'event InfectionAssigned(uint256 indexed roomId, address player)',
  'event PatientZeroUpdated(uint256 indexed roomId, address patientZero)',
  'event GameEnded(uint256 indexed roomId, uint8 outcome)',
  'event PotDrained(uint256 indexed roomId, address winner, uint256 amount)',
  'event RoomExpired(uint256 indexed roomId)',
  // Custom errors — included so viem can decode revert reasons by name
  'error Unauthorized()',
  'error InvalidRoom()',
  'error RoomNotWaiting()',
  'error RoomFull()',
  'error RoomExpiredError()',
  'error AlreadyJoined()',
  'error WrongStakeAmount()',
  'error NotHost()',
  'error NotEnoughPlayers()',
  'error NotActive()',
  'error WrongPhase()',
  'error AlreadyVoted()',
  'error AlreadyCommitted()',
  'error AlreadyProvedThisRound()',
  'error NullifierUsed()',
  'error InvalidProof()',
  'error NotParticipant()',
  'error NotAlive()',
  'error InvalidInfectionTarget()',
  'error RoleCommitmentPending()',
  'error TooManyActiveRooms()',
  'error Reentrancy()',
] as const)

// ── Client setup ──────────────────────────────────────────────────────────────

function buildClients() {
  const network    = (process.env.NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const chain      = network === 'mainnet' ? celo : celoSepolia
  const rpcUrl     = process.env.CELO_RPC_URL
  const fallbackRpcUrls = (process.env.CELO_RPC_FALLBACK_URLS ?? '')
    .split(',')
    .map(url => url.trim())
    .filter(Boolean)
  const address    = process.env.CONTRACT_ADDRESS as `0x${string}` | undefined
  const privateKey = process.env.BACKEND_PRIVATE_KEY as `0x${string}` | undefined
  const rpcTimeoutMs = Number(process.env.RPC_TIMEOUT_MS ?? 20_000)
  const rpcRetryCount = Number(process.env.RPC_RETRY_COUNT ?? 2)
  const rpcRetryDelayMs = Number(process.env.RPC_RETRY_DELAY_MS ?? 300)

  if (!address) throw new Error('CONTRACT_ADDRESS env var is not set')
  if (!privateKey) throw new Error('BACKEND_PRIVATE_KEY env var is not set')

  const defaultRpc = chain.rpcUrls.default.http[0]
  const rpcUrls = [rpcUrl ?? defaultRpc, ...fallbackRpcUrls]
  const transport = fallback(
    rpcUrls.map(url =>
      http(url, {
        timeout: rpcTimeoutMs,
        retryCount: rpcRetryCount,
        retryDelay: rpcRetryDelayMs,
      })
    )
  )

  const publicClient = createPublicClient({
    chain,
    transport,
  })

  const account      = privateKeyToAccount(privateKey)
  const walletClient = createWalletClient({
    account,
    chain,
    transport,
  })

  logger.info(`Chain adapter initialised: network=${network} contract=${address} rpcEndpoints=${rpcUrls.length}`)

  return { publicClient, walletClient, account, address, chain, rpcUrls, rpcTimeoutMs }
}

// Lazily initialised on first use so tests can import without .env being set.
let _clients: ReturnType<typeof buildClients> | null = null
function clients() {
  _clients ??= buildClients()
  return _clients
}

// ── Write helpers ─────────────────────────────────────────────────────────────

// Optional: pay backend gas in USDm instead of CELO.
// Set FEE_CURRENCY_ADDRESS=0x765DE816845861e75A25fCA122bb6022DB77Eaca on mainnet
// so the backend signer wallet needs no CELO — only USDm for gas.
const FEE_CURRENCY_ADDRESS = process.env.FEE_CURRENCY_ADDRESS as `0x${string}` | undefined

async function writeAndWait(functionName: string, args: readonly unknown[]) {
  const { publicClient, walletClient, address } = clients()
  const { request } = await publicClient.simulateContract({
    address,
    abi:          PLAGUE_ABI,
    functionName: functionName as never,
    args:         args as never,
    account:      walletClient.account,
    ...(FEE_CURRENCY_ADDRESS ? { feeCurrency: FEE_CURRENCY_ADDRESS } : {}),
  })
  const hash = await walletClient.writeContract(request as never)
  return publicClient.waitForTransactionReceipt({ hash })
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startRpcHealthMonitor(intervalMs = Number(process.env.RPC_HEALTH_CHECK_INTERVAL_MS ?? 30_000)): NodeJS.Timeout | null {
  const enabled = (process.env.RPC_HEALTH_MONITOR_ENABLED ?? 'true').toLowerCase() !== 'false'
  if (!enabled) return null

  const { rpcUrls, rpcTimeoutMs } = clients()
  logger.info(`[rpc-health] monitor started intervalMs=${intervalMs} endpoints=${rpcUrls.length}`)

  return setInterval(async () => {
    await Promise.all(rpcUrls.map(async (url) => {
      const result = await probeRpc(url, rpcTimeoutMs)
      if (!result.ok) {
        if (shouldLogRpc(url, false, result.error ?? 'unknown error')) {
          logger.warn(`[rpc-health] endpoint degraded url=${url} latencyMs=${result.latencyMs} error=${result.error ?? 'unknown'}`)
        }
        return
      }
      if (shouldLogRpc(url, true)) {
        logger.info(`[rpc-health] endpoint healthy url=${url} latencyMs=${result.latencyMs}`)
      }
    }))
  }, intervalMs)
}

export const chainAdapter = {
  /** Upstream RPC URLs (primary + fallbacks) this backend is configured with.
   *  Used by the browser-facing /api/rpc proxy so frontend reads go through
   *  our server (same-origin, no public-RPC CORS/rate-limit exposure). */
  getRpcUrls(): string[] {
    return clients().rpcUrls
  },

  // ── Reads ──────────────────────────────────────────────────────────────────

  async getRoom(roomId: bigint) {
    const { publicClient, address } = clients()
    return publicClient.readContract({
      address,
      abi:          PLAGUE_ABI,
      functionName: 'getRoom',
      args:         [roomId],
    })
  },

  async getPlayer(roomId: bigint, player: `0x${string}`) {
    const { publicClient, address } = clients()
    return publicClient.readContract({
      address,
      abi:          PLAGUE_ABI,
      functionName: 'getPlayer',
      args:         [roomId, player],
    })
  },

  async getRoomCount(): Promise<bigint> {
    const { publicClient, address } = clients()
    return publicClient.readContract({
      address,
      abi:          PLAGUE_ABI,
      functionName: 'roomCount',
    })
  },

  async getCurrentPatientZero(roomId: bigint): Promise<`0x${string}`> {
    const { publicClient, address } = clients()
    return publicClient.readContract({
      address,
      abi:          PLAGUE_ABI,
      functionName: 'currentPatientZero',
      args:         [roomId],
    })
  },

  async getLatestBlockHash(): Promise<string> {
    const { publicClient } = clients()
    const blockNumber = await publicClient.getBlockNumber()
    const block = await publicClient.getBlock({ blockNumber })
    return block.hash ?? '0x0'
  },

  /**
   * Query recent GameEnded event logs for a specific room.
   * Used when a client connects to an already-ended game so the backend
   * can replay the outcome without relying on the live event stream.
   * Returns the outcome (0=CleanWin, 1=InfectedWin, 2=Draw) or null if not found.
   */
  async getGameEndedLogs(roomId: bigint): Promise<{ outcome: number } | null> {
    const { publicClient, address } = clients()
    try {
      const currentBlock = await publicClient.getBlockNumber()
      // Celo ~5s/block → 10000 blocks ≈ 13.9 hours, covers most recent games
      const fromBlock = currentBlock > 10000n ? currentBlock - 10000n : 0n
      const logs = await publicClient.getContractEvents({
        address,
        abi:       PLAGUE_ABI,
        eventName: 'GameEnded',
        args:      { roomId },
        fromBlock,
        toBlock:   currentBlock,
      })
      if (logs.length === 0) return null
      const last = logs.at(-1)!
      return { outcome: Number((last.args as { outcome?: unknown }).outcome ?? 0) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.debug(`[chain] getGameEndedLogs failed for room ${roomId}: ${message}`)
      return null
    }
  },

  // ── Writes (signed by BACKEND_SIGNER) ─────────────────────────────────────

  /**
   * Create a new room on behalf of the backend. Returns the new roomId.
   * Note: the backend is not the host in the contract sense — for player-hosted
   * rooms, have the frontend call createRoom directly. This is for server-side
   * programmatic room creation.
   */
  async createRoom(
    maxPlayers: number,
    stakeAmount: bigint,
    proofFee: bigint,
    expirySecs = 600,
  ): Promise<bigint> {
    await writeAndWait('createRoom', [maxPlayers, stakeAmount, proofFee, BigInt(expirySecs)])
    return this.getRoomCount()
  },

  /** Start round 1 once all role commitments are received. */
  async beginActivePhase(roomId: bigint) {
    return writeAndWait('beginActivePhase', [roomId])
  },

  /** Eliminate players who did not commit roles before timeout while room is Starting. */
  async eliminateUncommittedPlayers(roomId: bigint) {
    return writeAndWait('eliminateUncommittedPlayers', [roomId])
  },

  /** Finalize timed-out Starting rooms that cannot proceed due to low committed count. */
  async finalizeStartTimeout(roomId: bigint) {
    return writeAndWait('finalizeStartTimeout', [roomId])
  },

  /**
   * Assign infection for the current round.
   *
    * Target selection is performed by backend game logic, typically:
    *   target = eligibleCleanAlive[ hash(roomId, round, prevTxHash) % count ]
   */
  async assignInfection(roomId: bigint, target: `0x${string}`) {
    return writeAndWait('assignInfection', [roomId, target])
  },

  /** Close Discussion and open Voting when the discussion timer expires. */
  async openVoting(roomId: bigint) {
    return writeAndWait('openVoting', [roomId])
  },

  /** Resolve the current voting phase (Cases A/B/C/D + endgame check). */
  async resolveRound(roomId: bigint) {
    return writeAndWait('resolveRound', [roomId])
  },

  /** Finalize elimination phase: endgame check and next-round transition. */
  async finalizeElimination(roomId: bigint) {
    return writeAndWait('finalizeElimination', [roomId])
  },

  /** Expire a waiting room whose timer has passed (permissionless on-chain too). */
  async expireRoom(roomId: bigint) {
    return writeAndWait('expireRoom', [roomId])
  },

  // ── Event watchers ─────────────────────────────────────────────────────────

  /**
   * Watch all PlagueGame events and call onLog for each one.
   * Returns an unwatch function — call it to stop watching.
   *
   * Usage in socket/handlers.ts:
   *   const unwatch = chainAdapter.watchAll((log) => {
   *     io.to(log.args.roomId.toString()).emit('game_event', mapLog(log))
   *   })
   */
  watchAll(onLog: (log: { eventName: string; args: Record<string, unknown> }) => void): () => void {
    const { publicClient, address } = clients()

    // Events we surface to the socket layer. getContractEvents decodes every
    // event on the ABI, so we filter down to this set to preserve behaviour.
    const watched = new Set<string>([
      'PlayerJoined', 'GameStarted', 'RoundStarted', 'PhaseChanged',
      'VoteCast', 'ProofSubmitted', 'PlayerEliminated', 'PlayerSavedByProof',
      'VoteResolved', 'InfectionAssigned', 'PatientZeroUpdated', 'GameEnded', 'PotDrained', 'RoomExpired',
    ])

    // Single incremental eth_getLogs poll instead of one filter subscription
    // per event. viem's watchContractEvent runs an eth_newFilter +
    // eth_getFilterChanges loop PER event (14 here), and on a load-balanced RPC
    // the filter is recreated on almost every poll (created on node A, polled
    // on node B, which never saw it) — a 24/7 eth_getFilterChanges storm that
    // drained an entire Alchemy free tier in ~2 days regardless of game
    // activity. getLogs is stateless: one read per tick, no filter affinity.
    // 10s keeps monthly getLogs cost (~85 CU/tick) around ~22M CU — safely
    // inside a 30M/mo Alchemy free tier with headroom for the browser floor
    // that shares the same key. Lower this only if you have budget to spare;
    // the socket layer already pushes snapshots immediately on backend-driven
    // phase changes, so this poll is a mirror/resilience layer, not the hot path.
    const pollMs = Number(process.env.CHAIN_EVENT_POLL_MS ?? 10_000)
    let fromBlock: bigint | null = null
    let running = false
    let stopped = false

    const tick = async () => {
      if (running || stopped) return
      running = true
      try {
        const latest = await publicClient.getBlockNumber()
        // First tick: start from the next block so we only surface new events,
        // matching watchContractEvent's default 'latest' behaviour.
        if (fromBlock === null) { fromBlock = latest + 1n; return }
        if (latest < fromBlock) return

        const logs = await publicClient.getContractEvents({
          address,
          abi:       PLAGUE_ABI,
          fromBlock,
          toBlock:   latest,
        })
        // Only advance the cursor after a successful read, so a failed poll
        // retries the same range instead of silently dropping events.
        fromBlock = latest + 1n

        for (const log of logs) {
          const eventName = (log as { eventName?: string }).eventName
          if (!eventName || !watched.has(eventName)) continue
          const args = (log as { args?: Record<string, unknown> }).args ?? {}
          logger.debug(`[chain] ${eventName}`, args)
          onLog({ eventName, args })
        }
      } catch (err) {
        logger.warn(`[chain] event poll failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        running = false
      }
    }

    const timer = setInterval(() => void tick(), pollMs)
    void tick()

    return () => { stopped = true; clearInterval(timer) }
  },
}
