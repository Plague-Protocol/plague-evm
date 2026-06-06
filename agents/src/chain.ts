/**
 * chain.ts — On-chain contract interactions for bot wallets.
 *
 * Uses viem with privateKeyToAccount (no browser wallet needed).
 * Pattern mirrors backend/src/services/chainAdapter.ts.
 */
import { parseAbi, maxUint256 } from 'viem'
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
  'event RoomCreated(uint256 indexed roomId, address indexed host)',
  'error AlreadyCommitted()',
  'error AlreadyVoted()',
  'error AlreadyJoined()',
  'error WrongPhase()',
  'error NotAlive()',
  'error NotParticipant()',
  'error RoomFull()',
  'error RoomNotWaiting()',
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
  await publicClient.waitForTransactionReceipt({ hash })

  console.log(`[bot-${bot.index}] Created room #${roomId}`)
  return roomId
}

/**
 * Join an existing room. The bot must have approved cUSD first.
 */
export async function joinRoom(bot: BotWallet, roomId: bigint): Promise<void> {
  const hash = await bot.walletClient.writeContract({
    account: bot.account,
    chain: CHAIN,
    ...feeCurrency(),
    address: CONTRACT_ADDRESS,
    abi: PLAGUE_ABI,
    functionName: 'joinRoom',
    args: [roomId],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log(`[bot-${bot.index}] Joined room #${roomId}`)
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
  await publicClient.waitForTransactionReceipt({ hash })
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
  await publicClient.waitForTransactionReceipt({ hash })
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
  await publicClient.waitForTransactionReceipt({ hash })
  console.log(`[bot-${bot.index}] Voted against ${target.slice(0, 8)}... in room #${roomId}`)
}

// ── Read helpers ──────────────────────────────────────────────────────────────

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
