/**
 * chain.ts — On-chain contract interactions for bot wallets.
 *
 * Uses viem with privateKeyToAccount (no browser wallet needed).
 * Pattern mirrors backend/src/services/chainAdapter.ts.
 */
import { parseAbi, maxUint256, decodeEventLog } from 'viem'
import { publicClient, CONTRACT_ADDRESS, USDM_ADDRESS, CHAIN, FEE_CURRENCY_ADDRESS } from './config.js'
import type { BotWallet } from './config.js'

// Optional feeCurrency — when set, gas is paid in USDm instead of CELO
function feeCurrency() {
  return FEE_CURRENCY_ADDRESS ? { feeCurrency: FEE_CURRENCY_ADDRESS } : {}
}

// ── ABIs ──────────────────────────────────────────────────────────────────────

export const PLAGUE_ABI = parseAbi([
  'function createRoom(uint32 maxPlayers, uint256 stakeAmount, uint256 proofFee, uint64 expirySecs) external returns (uint256 roomId)',
  'function joinRoom(uint256 roomId) external',
  'function startGame(uint256 roomId) external',
  'function submitRoleCommitment(uint256 roomId, bytes32 commitment, bytes calldata zkProof) external',
  'function castVote(uint256 roomId, address target) external',
  'function getRoom(uint256 roomId) external view returns ((uint256 id, address host, uint8 status, (uint32 minPlayers, uint32 maxPlayers, uint256 stakeAmount, uint32 maxRounds, uint64 roundDurationSecs, uint64 discussionDurationSecs, uint64 votingDurationSecs, uint64 expirySecs, uint256 proofFee) config, address[] players, uint32 currentRound, uint8 currentPhase, uint256 pot, uint64 createdAt, uint64 expiresAt, uint64 startedAt, uint64 phaseStartedAt))',
  'function getPlayer(uint256 roomId, address player) external view returns ((address addr, uint8 status, bytes32 roleCommitment, uint256 staked, address voteTarget, uint64 joinedAt, bool freeProofUsed, uint32 proofsSubmittedTotal, bool pendingInfectionNextRound, bool hasProofThisRound, bool hasVotedThisRound, bool roleCommitted))',
  'function roomCount() external view returns (uint256)',
  'function activeRoomCount() external view returns (uint256)',
  'function maxActiveRooms() external view returns (uint256)',
  'event RoomCreated(uint256 indexed roomId, address indexed host)',
  'error AlreadyCommitted()',
  'error AlreadyVoted()',
  'error AlreadyJoined()',
  'error WrongPhase()',
  'error NotAlive()',
  'error NotParticipant()',
  'error RoomFull()',
  'error RoomNotWaiting()',
  'error InvalidRoom()',
  'error RoomExpiredError()',
  'error TooManyActiveRooms()',
])

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 value) external returns (bool)',
])

// ── Write helpers ─────────────────────────────────────────────────────────────

/**
 * Ensure the bot's USDm allowance for the PlagueGame contract is at least
 * `minAmount`. Approves maxUint256 if not already sufficient.
 */
export async function ensureApproval(bot: BotWallet, minAmount: bigint): Promise<void> {
  const allowance = await publicClient.readContract({
    address: USDM_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [bot.address, CONTRACT_ADDRESS],
  })
  if (allowance >= minAmount) return

  console.log(`[bot-${bot.index}] Approving USDm...`)
  const hash = await bot.walletClient.writeContract({
    account: bot.account,
    chain: CHAIN,
    ...feeCurrency(),
    address: USDM_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [CONTRACT_ADDRESS, maxUint256],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log(`[bot-${bot.index}] USDm approved`)
}

/**
 * Create a room and return the new roomId.
 * Bot[0] is the host — they are automatically the first player.
 */
export async function createRoom(
  bot: BotWallet,
  stakeAmount: bigint,
  maxPlayers: number = 5,
  expirySecs: bigint = 600n,
): Promise<bigint> {
  // Simulate first to get return value (roomId)
  const { result: roomId } = await publicClient.simulateContract({
    account: bot.account,
    address: CONTRACT_ADDRESS,
    abi: PLAGUE_ABI,
    functionName: 'createRoom',
    args: [maxPlayers, stakeAmount, 0n, expirySecs],
  })

  const hash = await bot.walletClient.writeContract({
    account: bot.account,
    chain: CHAIN,
    ...feeCurrency(),
    address: CONTRACT_ADDRESS,
    abi: PLAGUE_ABI,
    functionName: 'createRoom',
    args: [maxPlayers, stakeAmount, 0n, expirySecs],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  // waitForTransactionReceipt resolves even for reverted txs — check explicitly,
  // otherwise a failed createRoom is silently treated as success and the stale
  // simulated roomId flows into joinRoom → InvalidRoom().
  if (receipt.status !== 'success') {
    throw new Error(`createRoom reverted (tx ${hash})`)
  }

  // Derive the real roomId from the RoomCreated event rather than trusting the
  // simulation result, which can be stale under concurrency.
  const actualRoomId = roomIdFromReceipt(receipt) ?? roomId

  // Read-after-write barrier. forno is a load-balanced node fleet: the receipt
  // may have been confirmed by one node while the next tx (joinRoom) gets routed
  // to a node still a block behind, which sees roomCount < roomId and reverts
  // InvalidRoom(). Poll until the new room is visible before anyone joins.
  await waitForRoomVisible(actualRoomId)

  console.log(`[bot-${bot.index}] Created room #${actualRoomId}`)
  return actualRoomId
}

/** Poll roomCount() until the freshly created room is visible to reads. */
async function waitForRoomVisible(roomId: bigint, attempts = 8, delayMs = 750): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const count = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: PLAGUE_ABI,
        functionName: 'roomCount',
      })
      if (count >= roomId) return
    } catch {
      // transient RPC error — retry on the next attempt
    }
    await new Promise(r => setTimeout(r, delayMs))
  }
  console.warn(`[chain] room #${roomId} not visible after ${attempts} polls — joining anyway`)
}

/** Wait for a tx and throw if it reverted (waitForTransactionReceipt does not). */
async function waitOrThrow(hash: `0x${string}`, label: string): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error(`${label} reverted (tx ${hash})`)
  }
}

/** Parse the RoomCreated event from a createRoom receipt to get the true roomId. */
function roomIdFromReceipt(receipt: { logs: readonly { topics: any; data: any }[] }): bigint | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: PLAGUE_ABI, topics: log.topics, data: log.data })
      if (decoded.eventName === 'RoomCreated') return (decoded.args as { roomId: bigint }).roomId
    } catch {
      // not a PlagueGame event — skip
    }
  }
  return null
}

/**
 * Join an existing room. The bot must have approved cUSD first.
 */
export async function joinRoom(bot: BotWallet, roomId: bigint, attempts = 4): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const hash = await bot.walletClient.writeContract({
        account: bot.account,
        chain: CHAIN,
        ...feeCurrency(),
        address: CONTRACT_ADDRESS,
        abi: PLAGUE_ABI,
        functionName: 'joinRoom',
        args: [roomId],
      })
      await waitOrThrow(hash, 'joinRoom')
      console.log(`[bot-${bot.index}] Joined room #${roomId}`)
      return
    } catch (err) {
      // InvalidRoom() (0x353cbf17) here is almost always a lagging RPC node that
      // hasn't yet applied the createRoom block — transient, so retry. Anything
      // else (RoomFull, AlreadyJoined, …) is terminal: rethrow immediately.
      const msg = err instanceof Error ? err.message : String(err)
      const transient = msg.includes('InvalidRoom') || msg.includes('0x353cbf17')
      if (!transient || i === attempts - 1) throw err
      console.warn(`[bot-${bot.index}] joinRoom #${roomId} saw stale state, retry ${i + 1}/${attempts - 1}`)
      await new Promise(r => setTimeout(r, 1_000))
    }
  }
}

/**
 * Start the game. Called by the host once the room is full.
 */
export async function startGame(bot: BotWallet, roomId: bigint): Promise<void> {
  const hash = await bot.walletClient.writeContract({
    account: bot.account,
    chain: CHAIN,
    ...feeCurrency(),
    address: CONTRACT_ADDRESS,
    abi: PLAGUE_ABI,
    functionName: 'startGame',
    args: [roomId],
  })
  await waitOrThrow(hash, 'startGame')
  console.log(`[bot-${bot.index}] Started game for room #${roomId}`)
}

/**
 * Submit a role commitment with a ZK proof.
 * commitment — bytes32 hex string (0x-prefixed)
 * proofHex   — UltraHonk proof bytes (0x-prefixed hex)
 */
export async function submitRoleCommitment(
  bot: BotWallet,
  roomId: bigint,
  commitment: `0x${string}`,
  proofHex: `0x${string}`,
): Promise<void> {
  const hash = await bot.walletClient.writeContract({
    account: bot.account,
    chain: CHAIN,
    ...feeCurrency(),
    address: CONTRACT_ADDRESS,
    abi: PLAGUE_ABI,
    functionName: 'submitRoleCommitment',
    args: [roomId, commitment, proofHex],
  })
  await waitOrThrow(hash, 'submitRoleCommitment')
  console.log(`[bot-${bot.index}] Committed role in room #${roomId}`)
}

/**
 * Cast a vote against `target`.
 */
export async function castVote(
  bot: BotWallet,
  roomId: bigint,
  target: `0x${string}`,
): Promise<void> {
  const hash = await bot.walletClient.writeContract({
    account: bot.account,
    chain: CHAIN,
    ...feeCurrency(),
    address: CONTRACT_ADDRESS,
    abi: PLAGUE_ABI,
    functionName: 'castVote',
    args: [roomId, target],
  })
  await waitOrThrow(hash, 'castVote')
  console.log(`[bot-${bot.index}] Voted against ${target.slice(0, 8)}... in room #${roomId}`)
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/**
 * Whether the contract has room for another active game. createRoom reverts with
 * TooManyActiveRooms() once activeRoomCount hits maxActiveRooms, so the pool
 * checks this before attempting a self-play game (backpressure, not an error).
 */
export async function hasRoomCapacity(): Promise<boolean> {
  const [active, max] = await Promise.all([
    publicClient.readContract({ address: CONTRACT_ADDRESS, abi: PLAGUE_ABI, functionName: 'activeRoomCount' }),
    publicClient.readContract({ address: CONTRACT_ADDRESS, abi: PLAGUE_ABI, functionName: 'maxActiveRooms' }),
  ])
  return active < max
}

export async function getRoom(roomId: bigint) {
  return publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: PLAGUE_ABI,
    functionName: 'getRoom',
    args: [roomId],
  })
}

export async function getPlayerStatus(
  roomId: bigint,
  playerAddress: `0x${string}`,
): Promise<number> {
  const player = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: PLAGUE_ABI,
    functionName: 'getPlayer',
    args: [roomId, playerAddress],
  })
  return Number(player.status)
}

/** PlayerStatus enum: 0 = Clean, 1 = Infected, 2 = Eliminated. */
export interface PlayerStatusEntry {
  addr: string // lowercased
  status: number
}

/**
 * Authoritative roster for a room: every player's address (lowercased) and
 * on-chain status. Used to drive voting from chain state rather than relying on
 * socket snapshots, which can be dropped by the backend's event relay.
 */
export async function getRoomStatuses(roomId: bigint): Promise<PlayerStatusEntry[]> {
  const room = await getRoom(roomId)
  const addrs = room.players as readonly `0x${string}`[]
  const statuses = await Promise.all(addrs.map(a => getPlayerStatus(roomId, a)))
  return addrs.map((a, i) => ({ addr: a.toLowerCase(), status: statuses[i] }))
}
