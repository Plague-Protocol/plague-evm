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
 *   CELO_RPC_URL        RPC endpoint (default: Alfajores public)
 *   CONTRACT_ADDRESS    Deployed PlagueGame address
 *   BACKEND_PRIVATE_KEY Hex private key for the backend signer wallet
 *   NETWORK             "testnet" | "mainnet"  (default: "testnet")
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celoSepolia, celo } from 'viem/chains'
import { logger } from '../lib/logger'

// ── ABI (subset used by the backend) ─────────────────────────────────────────

const PLAGUE_ABI = parseAbi([
  // Backend-only writes
  'function createRoom(uint32 maxPlayers, uint256 stakeAmount, uint256 proofFee, uint64 expirySecs) external returns (uint256)',
  'function beginActivePhase(uint256 roomId) external',
  'function assignInfection(uint256 roomId, address target) external',
  'function openVoting(uint256 roomId) external',
  'function resolveRound(uint256 roomId) external',
  'function expireRoom(uint256 roomId) external',
  // Reads
  'function getRoom(uint256 roomId) external view returns ((uint256 id, address host, uint8 status, (uint32 minPlayers, uint32 maxPlayers, uint256 stakeAmount, uint32 maxRounds, uint64 roundDurationSecs, uint64 discussionDurationSecs, uint64 votingDurationSecs, uint64 expirySecs, uint256 proofFee) config, address[] players, uint32 currentRound, uint8 currentPhase, uint256 pot, uint64 createdAt, uint64 expiresAt, uint64 startedAt, uint64 phaseStartedAt))',
  'function getPlayer(uint256 roomId, address player) external view returns ((address addr, uint8 status, bytes32 roleCommitment, uint256 staked, address voteTarget, uint64 joinedAt, bool freeProofUsed, uint32 proofsSubmittedTotal, bool pendingInfectionNextRound, bool hasProofThisRound, bool hasVotedThisRound, bool roleCommitted))',
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
  'error TooManyActiveRooms()',
  'error Reentrancy()',
] as const)

// ── Client setup ──────────────────────────────────────────────────────────────

function buildClients() {
  const network    = (process.env.NETWORK ?? 'testnet') as 'testnet' | 'mainnet'
  const chain      = network === 'mainnet' ? celo : celoSepolia
  const rpcUrl     = process.env.CELO_RPC_URL
  const address    = process.env.CONTRACT_ADDRESS as `0x${string}` | undefined
  const privateKey = process.env.BACKEND_PRIVATE_KEY as `0x${string}` | undefined

  if (!address) throw new Error('CONTRACT_ADDRESS env var is not set')
  if (!privateKey) throw new Error('BACKEND_PRIVATE_KEY env var is not set')

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const account      = privateKeyToAccount(privateKey)
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  logger.info(`Chain adapter initialised: network=${network} contract=${address}`)

  return { publicClient, walletClient, account, address, chain }
}

// Lazily initialised on first use so tests can import without .env being set.
let _clients: ReturnType<typeof buildClients> | null = null
function clients() {
  _clients ??= buildClients()
  return _clients
}

// ── Write helpers ─────────────────────────────────────────────────────────────

async function writeAndWait(functionName: string, args: readonly unknown[]) {
  const { publicClient, walletClient, address } = clients()
  const { request } = await publicClient.simulateContract({
    address,
    abi:          PLAGUE_ABI,
    functionName: functionName as never,
    args:         args as never,
    account:      walletClient.account,
  })
  const hash = await walletClient.writeContract(request as never)
  return publicClient.waitForTransactionReceipt({ hash })
}

// ── Public API ────────────────────────────────────────────────────────────────

export const chainAdapter = {
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

    const eventNames = [
      'PlayerJoined', 'GameStarted', 'RoundStarted', 'PhaseChanged',
      'VoteCast', 'ProofSubmitted', 'PlayerEliminated', 'PlayerSavedByProof',
      'VoteResolved', 'InfectionAssigned', 'PatientZeroUpdated', 'GameEnded', 'PotDrained', 'RoomExpired',
    ] as const

    const unwatchers: (() => void)[] = eventNames.map(eventName =>
      publicClient.watchContractEvent({
        address,
        abi:       PLAGUE_ABI,
        eventName: eventName as never,
        onLogs(logs: { args?: Record<string, unknown> }[]) {
          for (const log of logs) {
            logger.debug(`[chain] ${eventName}`, log.args)
            onLog({ eventName, args: log.args ?? {} })
          }
        },
      })
    )

    return () => unwatchers.forEach(u => u())
  },
}
