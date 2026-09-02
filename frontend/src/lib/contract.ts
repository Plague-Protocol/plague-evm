import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  http,
  maxUint256,
  parseAbi,
  parseEventLogs,
  type PublicClient,
} from 'viem'
import { celoSepolia, celo } from 'viem/chains'
import { EIP1193, type Wallet as ThirdwebWallet } from 'thirdweb/wallets'
import { toDataSuffix } from '@celo/attribution-tags'
import { thirdwebClient, targetChain } from './thirdweb'

/** MiniPay's in-app browser. Gates the wallet quirks it doesn't share with
 *  extension wallets: no chain switching, and gas paid in stablecoin. */
function isMiniPay(): boolean {
  return !!globalThis.window?.ethereum?.isMiniPay
}

// ── CIP-64 fee abstraction ────────────────────────────────────────────────────
// Celo mainnet fee-currency adapters. USDm is the 18-decimal Mento dollar the
// game already settles in; the USDC/USDT entries are the 6-decimal gas adapters,
// kept here for reference since MiniPay may charge in either.
export const FEE_CURRENCY_USDM = '0x765DE816845861e75A25fCA122bb6898B8B1282a' as const
export const FEE_CURRENCY_USDC_ADAPTER = '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B' as const
export const FEE_CURRENCY_USDT_ADAPTER = '0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72' as const

/**
 * Whether this provider can sign a CIP-64 (type 123) transaction.
 *
 * MUST stay a positive allowlist. Passing `feeCurrency` makes viem serialise a
 * Celo-specific transaction type that MetaMask and other generic EVM wallets
 * cannot sign — so a wallet we merely *fail to recognise* has to fall through to
 * the native-CELO path. Guessing optimistically here would break signing against
 * a live contract holding real stakes.
 *
 * Note MiniPay is listed but does not actually honour the value: per its docs it
 * "may ignore feeCurrency and choose the token the user has the most of". We set
 * it anyway so the intent is explicit in code rather than implied.
 */
function supportsFeeCurrency(): boolean {
  const eth = globalThis.window?.ethereum
  if (!eth) return false
  return !!(eth.isMiniPay || eth.isValora || eth.isOpera)
}

/**
 * The CIP-64 fee currency for a write, or undefined to pay in native CELO.
 * Mainnet only — these adapter addresses do not exist on Celo Sepolia.
 */
function feeCurrencyFor(chainId: number): `0x${string}` | undefined {
  if (chainId !== 42220) return undefined
  return supportsFeeCurrency() ? FEE_CURRENCY_USDM : undefined
}

// ── Attribution (Celo Builders hackathon) ──────────────────────────────────────
// Celo Builders "Agentic Payments & DeFAI" hackathon attribution tag, appended to
// every user write tx's calldata via viem's `dataSuffix` so the tx is credited on
// the leaderboard (Celo mainnet, ends 2026-08-03). The contract ignores the
// trailing bytes; only the registered tag is credited. Decode with `verifyTx` from
// @celo/attribution-tags. Override via NEXT_PUBLIC_ATTRIBUTION_TAG if it changes.
const ATTRIBUTION_SUFFIX = toDataSuffix(
  process.env.NEXT_PUBLIC_ATTRIBUTION_TAG ?? 'celo_c2d022d1d4ac',
)

// ── ABI ───────────────────────────────────────────────────────────────────────
// Mirrors PlagueGame.sol — update if the Solidity interface changes.

const PLAGUE_GAME_ABI = parseAbi([
  // Write functions
  'function createRoom(uint32 maxPlayers, uint256 stakeAmount, uint256 proofFee, uint64 expirySecs) external returns (uint256 roomId)',
  'function joinRoom(uint256 roomId) external',
  'function startGame(uint256 roomId) external',
  'function submitRoleCommitment(uint256 roomId, bytes32 commitment, bytes calldata zkProof) external',
  'function castVote(uint256 roomId, address target) external',
  'function submitInnocenceProof(uint256 roomId, bytes32 commitment, bytes32 nullifier, bytes calldata zkProof) external',
  'function resolveRound(uint256 roomId) external',
  'function expireRoom(uint256 roomId) external',
  // View functions
  'function getRoom(uint256 roomId) external view returns ((uint256 id, address host, uint8 status, (uint32 minPlayers, uint32 maxPlayers, uint256 stakeAmount, uint32 maxRounds, uint64 roundDurationSecs, uint64 discussionDurationSecs, uint64 votingDurationSecs, uint64 expirySecs, uint256 proofFee) config, address[] players, uint32 currentRound, uint8 currentPhase, uint256 pot, uint64 createdAt, uint64 expiresAt, uint64 startedAt, uint64 phaseStartedAt))',
  'function getPlayer(uint256 roomId, address player) external view returns ((address addr, uint8 status, bytes32 roleCommitment, uint256 staked, address voteTarget, uint64 joinedAt, bool freeProofUsed, uint32 proofsSubmittedTotal, bool pendingInfectionNextRound, bool hasProofThisRound, bool hasVotedThisRound, bool roleCommitted))',
  'function currentPatientZero(uint256 roomId) external view returns (address)',
  'function roomCount() external view returns (uint256)',
  'function admin() external view returns (address)',
  'function backendSigner() external view returns (address)',
  'function platformFees() external view returns (uint256)',
  'function platformReceiver() external view returns (address)',
  'function activeRoomCount() external view returns (uint256)',
  'function maxActiveRooms() external view returns (uint256)',
  'function withdrawPlatformFees() external',
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
  'event RoomCreated(uint256 indexed roomId, address indexed host)',
  // Custom errors (required for viem to decode revert reasons by name)
  'error Unauthorized()',
  'error AlreadyInitialized()',
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
  'error TooManyActiveRooms()',
  'error NotParticipant()',
  'error NotAlive()',
  'error InvalidInfectionTarget()',
  'error InvalidProof()',
  'error Reentrancy()',
] as const)

export { PLAGUE_GAME_ABI }

// ── Config ────────────────────────────────────────────────────────────────────

const CHAINS = {
  testnet: celoSepolia,  // chainId 11142220
  mainnet: celo,         // chainId 42220
} as const

// ── RPC fallback transport ──────────────────────────────────────────────────────
// Reads go through a fallback transport that rotates to a backup endpoint when
// the primary is unhealthy, so a momentary blip doesn't surface as a broken lobby.
//
// PRIMARY is our own backend's /api/rpc proxy: public Celo RPCs (forno, drpc)
// rate-limit by browser origin and drop CORS headers on throttled responses,
// which under load floods the console with "No 'Access-Control-Allow-Origin'"
// errors and freezes the UI. The same-origin proxy sidesteps that entirely and
// forwards server-side to healthy upstreams. Public RPCs remain as fallbacks
// for the case where our backend is unreachable.

const DEFAULT_RPCS: Record<number, string[]> = {
  [celo.id]:        ['https://forno.celo.org', 'https://celo.drpc.org'],
  [celoSepolia.id]: ['https://forno.celo-sepolia.celo-testnet.org', 'https://celo-sepolia.drpc.org'],
}

function backendRpcProxyUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL
  if (!base) return undefined
  return `${base.replace(/\/$/, '')}/api/rpc`
}

function readTransport(chain: typeof celo | typeof celoSepolia, override?: string) {
  const envFallbacks = (process.env.NEXT_PUBLIC_CELO_RPC_FALLBACK_URLS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  // Priority order (deduped, first wins in viem's fallback transport):
  //   1. explicit per-client override (rarely used)
  //   2. backend same-origin proxy — the reliable path; must beat a stale
  //      NEXT_PUBLIC_CELO_RPC_URL=forno on the deploy or the CORS storm returns
  //   3. env primary / extra fallbacks
  //   4. public RPCs as last-ditch (will CORS-fail in-browser, but harmless tail)
  const urls = [...new Set([
    override,
    backendRpcProxyUrl(),
    process.env.NEXT_PUBLIC_CELO_RPC_URL || undefined,
    ...envFallbacks,
    ...(DEFAULT_RPCS[chain.id] ?? []),
  ].filter(Boolean))] as string[]
  return fallback(
    urls.map(url => http(url, { retryCount: 1, retryDelay: 300 })),
  )
}

/**
 * Calldata budget for a single Multicall3 aggregate3, in bytes.
 *
 * viem defaults to 1024, which splits one logical batch across many HTTP
 * requests: a 60-room lobby sweep is ~6 KB of calldata and became a request
 * per kilobyte, every refresh. 32 KB comfortably holds the largest sweep in
 * one round-trip and is well inside what an RPC node will accept.
 */
const MULTICALL_BATCH_SIZE = 32_768

/**
 * Read-only client factory. Single definition so the concrete chain/transport
 * generics are inferred once — annotating a field as
 * `ReturnType<typeof createPublicClient>` widens `chain` to the default and
 * the assignment stops type-checking.
 */
function makeReadClient(chain: typeof celo | typeof celoSepolia, rpcUrl?: string) {
  return createPublicClient({
    chain,
    transport: readTransport(chain, rpcUrl),
    batch:     { multicall: { batchSize: MULTICALL_BATCH_SIZE, wait: 16 } },
  })
}

type ReadClient = ReturnType<typeof makeReadClient>

export interface ContractConfig {
  contractAddress: `0x${string}`
  network: 'testnet' | 'mainnet'
  /** Override the default public RPC. */
  rpcUrl?: string
}

// ── Client ────────────────────────────────────────────────────────────────────

export class PlagueContractClient {
  private readonly address: `0x${string}`
  private readonly chain: typeof celo | typeof celoSepolia
  private readonly rpcUrl: string | undefined

  constructor(config: ContractConfig) {
    this.address = config.contractAddress
    this.chain   = CHAINS[config.network]
    this.rpcUrl  = config.rpcUrl
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * One client per instance, built once.
   *
   * This used to be a plain getter that called `createPublicClient` on EVERY
   * access — a fresh client, and therefore a fresh empty cache, for every read
   * the app made. viem dedupes in-flight requests and batches eligible
   * `readContract` calls into Multicall3, but both of those live on the client,
   * so recreating it discarded them every time. Measured on `/lobby` mobile:
   * 379 JSON-RPC calls in the 45s after load (~8/s, sustained), 11.5 MB — 81%
   * of the page's bytes and 75% of its requests.
   *
   * `batch.multicall` additionally folds independent `readContract` calls that
   * land in the same tick into one aggregate3. batchSize is raised from viem's
   * 1024-byte default because a 60-room lobby sweep is ~6 KB of calldata and
   * was being chopped into a fresh HTTP request every 1 KB.
   */
  private cachedPublicClient: ReadClient | undefined

  private get publicClient() {
    this.cachedPublicClient ??= makeReadClient(this.chain, this.rpcUrl)
    return this.cachedPublicClient
  }

  private walletClient(account: `0x${string}`) {
    return makeWalletClient(account, this.chain)
  }

  /**
   * Gas limit to pass to writeContract, or undefined to let the wallet decide.
   *
   * We normally estimate here and pass an explicit limit so MetaMask doesn't
   * run eth_estimateGas against its own (potentially lagging) RPC and render
   * "Unavailable" for the network fee.
   *
   * MiniPay is the exception. Its users hold no native CELO — MiniPay pays the
   * fee in whichever stablecoin they hold most of (it overrides any feeCurrency
   * we set). But our estimate goes through the RPC proxy with no feeCurrency,
   * so the node simulates a native-CELO payer with a zero balance and can
   * reject with "insufficient funds" before MiniPay is ever consulted. Omitting
   * `gas` hands estimation to MiniPay, which knows which token it's charging.
   */
  private async gasLimitFor(params: Parameters<PublicClient['estimateContractGas']>[0]): Promise<bigint | undefined> {
    if (isMiniPay()) return undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const estimate = await this.publicClient.estimateContractGas(params as any)
    return estimate * 130n / 100n // 30 % buffer
  }

  private async ensureChain(): Promise<void> {
    if (!globalThis.window?.ethereum) return
    // MiniPay is Celo-only and does not implement wallet_switchEthereumChain.
    // It rejects with something other than 4902, which the catch below
    // rethrows — killing every transaction. There is no chain to switch to,
    // so skip the check entirely.
    if (isMiniPay()) return
    const chainHex = `0x${this.chain.id.toString(16)}`
    try {
      await globalThis.window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainHex }],
      })
    } catch (switchErr: unknown) {
      if (typeof switchErr === 'object' && switchErr !== null && 'code' in switchErr && (switchErr as { code: number }).code === 4902) {
        await globalThis.window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainHex,
            chainName: this.chain.name,
            nativeCurrency: this.chain.nativeCurrency,
            rpcUrls: this.chain.rpcUrls.default.http,
            blockExplorerUrls: this.chain.blockExplorers ? [this.chain.blockExplorers.default.url] : [],
          }],
        })
      } else {
        throw switchErr
      }
    }
  }

  private async sendTx(account: `0x${string}`, request: unknown) {
    // Ensure the wallet is on the correct chain before sending
    await this.ensureChain()
    const wc   = this.walletClient(account)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await wc.writeContract(request as any)
    return this.publicClient.waitForTransactionReceipt({ hash })
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Create a new game room. Returns the on-chain roomId (bigint).
   */
  async createRoom(
    account: `0x${string}`,
    maxPlayers: number,
    stakeAmount: bigint,
    proofFee: bigint,
    expirySecs = 600,
  ): Promise<bigint> {
    // Skip simulateContract — the public RPC may return stale allowance state
    // immediately after approveCUSD, causing a false revert in simulation.
    // writeContract sends the tx directly; the receipt contains the RoomCreated
    // event which gives us the real on-chain roomId.
    // Estimate gas via our publicClient (which has confirmed the approval is
    // indexed — see approveCUSD). See gasLimitFor for why this is skipped
    // under MiniPay.
    const gas = await this.gasLimitFor({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'createRoom',
      args:         [maxPlayers, stakeAmount, proofFee, BigInt(expirySecs)],
      account,
    })
    await this.ensureChain()
    const wc   = this.walletClient(account)
    const hash = await wc.writeContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'createRoom',
      args:         [maxPlayers, stakeAmount, proofFee, BigInt(expirySecs)],
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
      gas,
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status === 'reverted') {
      // Re-simulate at latest state to extract the typed revert reason.
      // (Forno does not support historical eth_call at a specific blockNumber.)
      await this.publicClient.simulateContract({
        address:      this.address,
        abi:          PLAGUE_GAME_ABI,
        functionName: 'createRoom',
        args:         [maxPlayers, stakeAmount, proofFee, BigInt(expirySecs)],
        account,
      })
      throw new Error('createRoom transaction reverted')
    }
    const logs = parseEventLogs({
      abi:       PLAGUE_GAME_ABI,
      logs:      receipt.logs,
      eventName: 'RoomCreated',
    })
    if (logs.length > 0) return logs[0].args.roomId
    throw new Error('RoomCreated event not found in transaction receipt')
  }

  /**
   * Join a room and stake the required cUSD amount.
   * Caller must have approved the game contract for at least stakeAmount cUSD beforehand.
   * Use `approveStake` to send the ERC-20 approval transaction first.
   */
  async joinRoom(account: `0x${string}`, roomId: bigint): Promise<void> {
    // Skip simulateContract for the same stale-allowance reason as createRoom.
    const gas = await this.gasLimitFor({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'joinRoom',
      args:         [roomId],
      account,
    })
    await this.ensureChain()
    const wc   = this.walletClient(account)
    const hash = await wc.writeContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'joinRoom',
      args:         [roomId],
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
      gas,
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status === 'reverted') {
      // Re-simulate at latest state to extract the typed revert reason.
      await this.publicClient.simulateContract({
        address:      this.address,
        abi:          PLAGUE_GAME_ABI,
        functionName: 'joinRoom',
        args:         [roomId],
        account,
      })
      throw new Error('joinRoom transaction reverted')
    }
  }

  /**
   * Approve the game contract to spend cUSD on behalf of the caller.
   * - Checks the current on-chain allowance first; skips the approve tx entirely
   *   if the allowance is already sufficient (common on repeat calls).
   * - When an approval IS needed, approves MaxUint256 so the user never has to
   *   approve again, regardless of how many rooms they join.
   * - After the approval is mined, polls the allowance on our RPC node until
   *   the new value is visible, so the subsequent writeContract call is never
   *   submitted to a node with stale state.
   */
  async approveCUSD(
    account: `0x${string}`,
    cUSDAddress: `0x${string}`,
    amount: bigint,
  ): Promise<void> {
    const erc20Abi = parseAbi([
      'function approve(address spender, uint256 amount) external returns (bool)',
      'function allowance(address owner, address spender) external view returns (uint256)',
    ])
    // Skip approve if allowance is already sufficient.
    const current = await this.publicClient.readContract({
      address:      cUSDAddress,
      abi:          erc20Abi,
      functionName: 'allowance',
      args:         [account, this.address],
    })
    if (current >= amount) return
    // Approve MaxUint256 — set-and-forget; never needs re-approval.
    const wc = this.walletClient(account)
    const hash = await wc.writeContract({
      address:      cUSDAddress,
      abi:          erc20Abi,
      functionName: 'approve',
      args:         [this.address, maxUint256],
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
    })
    await this.publicClient.waitForTransactionReceipt({ hash })
    // Poll until our RPC node reflects the updated allowance.
    for (let i = 0; i < 12; i++) {
      const updated = await this.publicClient.readContract({
        address:      cUSDAddress,
        abi:          erc20Abi,
        functionName: 'allowance',
        args:         [account, this.address],
      })
      if (updated >= amount) return
      await new Promise<void>(res => { setTimeout(res, 1500) })
    }
    throw new Error('Allowance not visible on RPC after approval mined — please try again in a moment.')
  }

  /** Host closes the join window and starts the game. */
  async startGame(account: `0x${string}`, roomId: bigint): Promise<void> {
    const { request } = await this.publicClient.simulateContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'startGame',
      args:         [roomId],
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
    })
    await this.sendTx(account, request)
  }

  /**
   * Submit ZK role commitment (called during Starting phase).
   * @param commitment  Poseidon(role, secret) as a 32-byte hex string.
   * @param zkProof     Groth16 proof bytes from nargo prove (empty for dev bypass).
   */
  async submitRoleCommitment(
    account: `0x${string}`,
    roomId: bigint,
    commitment: `0x${string}`,
    zkProof: `0x${string}` = '0x',
  ): Promise<void> {
    const { request } = await this.publicClient.simulateContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'submitRoleCommitment',
      args:         [roomId, commitment, zkProof],
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
    })
    await this.sendTx(account, request)
  }

  /** Cast a vote during the Voting phase. */
  async castVote(account: `0x${string}`, roomId: bigint, target: `0x${string}`): Promise<void> {
    const { request } = await this.publicClient.simulateContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'castVote',
      args:         [roomId, target],
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
    })
    await this.sendTx(account, request)
  }

  /**
   * Submit a ZK innocence proof during the Discussion phase.
   * First proof per game is free. Subsequent proofs require a prior ERC-20
   * approval for the proof fee amount via `approveCUSD`.
   */
  async submitInnocenceProof(
    account: `0x${string}`,
    roomId: bigint,
    commitment: `0x${string}`,
    nullifier: `0x${string}`,
    zkProof: `0x${string}` = '0x',
  ): Promise<void> {
    const { request } = await this.publicClient.simulateContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'submitInnocenceProof',
      args:         [roomId, commitment, nullifier, zkProof],
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
    })
    await this.sendTx(account, request)
  }

  /**
   * Expire a waiting room whose timer has elapsed.
   * Permissionless — anyone can call this; stakes are auto-refunded.
   */
  async expireRoom(account: `0x${string}`, roomId: bigint): Promise<void> {
    const { request } = await this.publicClient.simulateContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'expireRoom',
      args:         [roomId],
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
    })
    await this.sendTx(account, request)
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async getRoom(roomId: bigint) {
    return this.publicClient.readContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'getRoom',
      args:         [roomId],
    })
  }

  /**
   * Batch-read many rooms in a single round-trip via Multicall3, instead of one
   * eth_call per room. Collapses the lobby's N getRoom reads into ONE request
   * through the proxy — the difference between a snappy lobby and a frozen one
   * once the contract has accumulated a hundred-plus rooms. Returns one entry
   * per requested id (in order); `room` is null for ids that revert.
   */
  async getRooms(
    roomIds: bigint[],
  ): Promise<{ id: bigint; room: Awaited<ReturnType<PlagueContractClient['getRoom']>> | null }[]> {
    if (roomIds.length === 0) return []
    const results = await this.publicClient.multicall({
      allowFailure: true,
      batchSize:    MULTICALL_BATCH_SIZE,
      contracts: roomIds.map(id => ({
        address:      this.address,
        abi:          PLAGUE_GAME_ABI,
        functionName: 'getRoom' as const,
        args:         [id] as const,
      })),
    })
    return roomIds.map((id, i) => {
      const r = results[i]
      return { id, room: r.status === 'success' ? r.result : null }
    })
  }

  async getPlayer(roomId: bigint, playerAddress: `0x${string}`) {
    return this.publicClient.readContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'getPlayer',
      args:         [roomId, playerAddress],
    })
  }

  /**
   * Batch-read every player in a room in a single Multicall3 round-trip instead
   * of one eth_call per player. The game refresh runs on a timer and on every
   * phase change; collapsing 1+N reads to ~2 keeps those bursts from tripping
   * the shared RPC rate limit. Results are returned in the same order as
   * `playerAddresses`. Throws (like the per-call path) if any read reverts.
   */
  async getPlayers(roomId: bigint, playerAddresses: `0x${string}`[]) {
    if (playerAddresses.length === 0) return []
    return this.publicClient.multicall({
      allowFailure: false,
      batchSize:    MULTICALL_BATCH_SIZE,
      contracts: playerAddresses.map(addr => ({
        address:      this.address,
        abi:          PLAGUE_GAME_ABI,
        functionName: 'getPlayer' as const,
        args:         [roomId, addr] as const,
      })),
    })
  }

  async getRoomCount(): Promise<bigint> {
    return this.publicClient.readContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'roomCount',
    })
  }

  async getCurrentPatientZero(roomId: bigint): Promise<`0x${string}`> {
    return this.publicClient.readContract({
      address: this.address,
      abi: PLAGUE_GAME_ABI,
      functionName: 'currentPatientZero',
      args: [roomId],
    })
  }

  /** Sign an arbitrary message with the connected wallet (admin config edits). */
  async signMessage(account: `0x${string}`, message: string): Promise<`0x${string}`> {
    return this.walletClient(account).signMessage({ account, message })
  }

  /** The contract's admin address (used to gate the ops UI; writes are enforced on-chain). */
  async getAdmin(): Promise<`0x${string}`> {
    return this.publicClient.readContract({
      address: this.address,
      abi: PLAGUE_GAME_ABI,
      functionName: 'admin',
    })
  }

  /** Admin-facing contract state, batched into one Multicall3 round-trip. */
  async getAdminInfo() {
    const read = <F extends string>(functionName: F) => ({
      address: this.address,
      abi: PLAGUE_GAME_ABI,
      functionName,
    })
    const [admin, backendSigner, platformFees, platformReceiver, activeRoomCount, maxActiveRooms] =
      await this.publicClient.multicall({
        allowFailure: false,
        contracts: [
          read('admin' as const),
          read('backendSigner' as const),
          read('platformFees' as const),
          read('platformReceiver' as const),
          read('activeRoomCount' as const),
          read('maxActiveRooms' as const),
        ],
      })
    return { admin, backendSigner, platformFees, platformReceiver, activeRoomCount, maxActiveRooms }
  }

  /** Sweep accumulated platform fees to platformReceiver. Contract enforces onlyAdmin. */
  async withdrawPlatformFees(account: `0x${string}`): Promise<void> {
    const { request } = await this.publicClient.simulateContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'withdrawPlatformFees',
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
    })
    await this.sendTx(account, request)
  }
}

export function createContractClient(config: ContractConfig): PlagueContractClient {
  return new PlagueContractClient(config)
}

// ── Shared wallet helper ──────────────────────────────────────────────────────

/**
 * The connected thirdweb wallet, published here by WalletProvider.
 *
 * Signing needs an EIP-1193 provider, and for a long time this file only knew
 * how to find one at `window.ethereum`. That silently excluded the connect
 * modal's *first and most prominent* option: social sign-in creates a thirdweb
 * in-app wallet, which injects nothing. Those users could connect, see their
 * address and read their balance, then hit "No EIP-1193 wallet provider found"
 * on every single write.
 *
 * A module-level handle rather than a parameter because the contract client is
 * built outside React (`createContractClient`) and threading a wallet through
 * every call site would touch far more code than the bug is worth.
 */
let connectedWallet: ThirdwebWallet | null = null

export function setConnectedWallet(wallet: ThirdwebWallet | null): void {
  connectedWallet = wallet
}

function makeWalletClient(account: `0x${string}`, chain: typeof celo | typeof celoSepolia) {
  const injected = globalThis.window?.ethereum

  // MiniPay keeps using its injected provider directly. That path is verified
  // on a real device and adapting it through thirdweb would re-route the one
  // wallet whose behaviour we have actually confirmed, for no gain — MiniPay
  // connects by wrapping this same provider in the first place.
  const provider = isMiniPay() && injected
    ? injected
    : connectedWallet
      ? EIP1193.toProvider({ wallet: connectedWallet, chain: targetChain(), client: thirdwebClient })
      : injected

  if (!provider) {
    throw new Error('No wallet connected. Sign in or connect a wallet, then try again.')
  }

  // Everything else prefers the thirdweb wallet, because thirdweb is what
  // actually holds the connection here. Preferring `window.ethereum` would be
  // wrong whenever both exist: a user who signed in with Google in a browser
  // that also has MetaMask installed would have their transaction sent to
  // MetaMask, addressed from an account MetaMask has never heard of.
  return createWalletClient({
    account,
    chain,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: custom(provider as any),
  })
}

// ── FaucetCUSD ────────────────────────────────────────────────────────────────
// Mirrors FaucetCUSD.sol — testnet only.

const FAUCET_ABI = parseAbi([
  'function claim() external',
  'function nextClaimAt(address user) external view returns (uint256)',
  'function faucetBalance() external view returns (uint256)',
  'function dripAmount() external view returns (uint256)',
] as const)

const ERC20_BALANCE_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
] as const)

export interface FaucetConfig {
  faucetAddress: `0x${string}`
  network: 'testnet' | 'mainnet'
}

export class FaucetClient {
  private readonly address: `0x${string}`
  private readonly chain: typeof celo | typeof celoSepolia

  constructor(config: FaucetConfig) {
    this.address = config.faucetAddress
    this.chain   = CHAINS[config.network]
  }

  /** Shared per-chain client — see the note on PlagueContractClient.publicClient. */
  private get publicClient() {
    return sharedReadClient(this.chain)
  }

  private walletClient(account: `0x${string}`) {
    return makeWalletClient(account, this.chain)
  }

  /** Claim dripAmount cUSD. Reverts if in cooldown or faucet is empty. */
  async claim(account: `0x${string}`): Promise<void> {
    if (globalThis.window?.ethereum) {
      const chainHex = `0x${this.chain.id.toString(16)}`
      try {
        await globalThis.window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainHex }],
        })
      } catch (switchErr: unknown) {
        if (typeof switchErr === 'object' && switchErr !== null && 'code' in switchErr && (switchErr as { code: number }).code === 4902) {
          await globalThis.window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: chainHex,
              chainName: this.chain.name,
              nativeCurrency: this.chain.nativeCurrency,
              rpcUrls: this.chain.rpcUrls.default.http,
              blockExplorerUrls: this.chain.blockExplorers ? [this.chain.blockExplorers.default.url] : [],
            }],
          })
        } else {
          throw switchErr
        }
      }
    }
    const wc   = this.walletClient(account)
    const hash = await wc.writeContract({
      address:      this.address,
      abi:          FAUCET_ABI,
      functionName: 'claim',
      account,
      dataSuffix:   ATTRIBUTION_SUFFIX,
      feeCurrency:  feeCurrencyFor(this.chain.id),
    })
    await this.publicClient.waitForTransactionReceipt({ hash })
  }

  /**
   * Unix timestamp (seconds) when `user` may next claim.
   * Returns 0 if the user has never claimed (can claim immediately).
   */
  async getNextClaimAt(user: `0x${string}`): Promise<bigint> {
    return this.publicClient.readContract({
      address:      this.address,
      abi:          FAUCET_ABI,
      functionName: 'nextClaimAt',
      args:         [user],
    })
  }

  /** Amount of cUSD dispensed per claim (wei). */
  async getDripAmount(): Promise<bigint> {
    return this.publicClient.readContract({
      address:      this.address,
      abi:          FAUCET_ABI,
      functionName: 'dripAmount',
    })
  }
}

export function createFaucetClient(config: FaucetConfig): FaucetClient {
  return new FaucetClient(config)
}

/**
 * Shared read-only clients for the module-level helpers below, one per chain.
 *
 * Same reasoning as PlagueContractClient.publicClient: these helpers are called
 * on a timer (balance polling), and building a client per call threw away
 * viem's in-flight dedup and multicall batching every time.
 */
const sharedReadClients = new Map<number, ReadClient>()

function sharedReadClient(chain: typeof celo | typeof celoSepolia): ReadClient {
  const hit = sharedReadClients.get(chain.id)
  if (hit) return hit
  const pc = makeReadClient(chain)
  sharedReadClients.set(chain.id, pc)
  return pc
}

/**
 * Read an ERC-20 (cUSD) balance for `account` without needing a full client.
 */
export async function readCUSDBalance(
  account: `0x${string}`,
  cUSDAddress: `0x${string}`,
  network: 'testnet' | 'mainnet',
): Promise<bigint> {
  const chain = CHAINS[network]
  const pc = sharedReadClient(chain)
  return pc.readContract({
    address:      cUSDAddress,
    abi:          ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args:         [account],
  })
}

/**
 * Native CELO balance (wei) of `account`. Used to warn non-MiniPay users who
 * lack the CELO needed to pay gas — MiniPay abstracts gas in stablecoin so it
 * never needs this. Mirrors readCUSDBalance's transport/fallback setup.
 */
export async function readNativeBalance(
  account: `0x${string}`,
  network: 'testnet' | 'mainnet',
): Promise<bigint> {
  const chain = CHAINS[network]
  const pc = sharedReadClient(chain)
  return pc.getBalance({ address: account })
}


/** ERC-8004 Identity Registry, Celo mainnet. */
export const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const

const IDENTITY_ABI = [{
  name: 'agentIdOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'owner', type: 'address' }],
  outputs: [{ type: 'uint256' }],
}] as const

/**
 * ERC-8004 agent ids for a set of addresses, keyed by lowercased address.
 * Addresses with no registration are omitted.
 *
 * This is what lets the game show that a player is a verifiable autonomous
 * agent rather than asking anyone to take our word for it — the id resolves on
 * 8004scan independently of us.
 *
 * The registry is mainnet-only, so testnet returns empty rather than throwing.
 * Reads go through sharedReadClient, whose multicall batching folds these into
 * one request — a per-player round trip was what made the lobby's unbatched
 * eth_calls a page-weight problem before.
 */
export async function readAgentIds(
  accounts: readonly `0x${string}`[],
  network: 'testnet' | 'mainnet',
): Promise<Record<string, string>> {
  if (network !== 'mainnet' || accounts.length === 0) return {}
  const pc = sharedReadClient(CHAINS[network])

  const results = await Promise.all(accounts.map(async addr => {
    try {
      const id = await pc.readContract({
        address: IDENTITY_REGISTRY, abi: IDENTITY_ABI,
        functionName: 'agentIdOf', args: [addr],
      })
      return id && id > 0n ? ([addr.toLowerCase(), id.toString()] as const) : null
    } catch {
      // An unregistered address or an RPC hiccup both mean "no badge". Never
      // let an identity lookup break the roster.
      return null
    }
  }))

  return Object.fromEntries(results.filter((r): r is readonly [string, string] => r !== null))
}
