import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  http,
  maxUint256,
  parseAbi,
  parseEventLogs,
} from 'viem'
import { celoSepolia, celo } from 'viem/chains'

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

  private get publicClient() {
    return createPublicClient({
      chain:     this.chain,
      transport: readTransport(this.chain, this.rpcUrl),
    })
  }

  private walletClient(account: `0x${string}`) {
    return makeWalletClient(account, this.chain)
  }

  private async ensureChain(): Promise<void> {
    if (!globalThis.window?.ethereum) return
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
    // indexed — see approveCUSD). Passing an explicit gas to writeContract
    // prevents MetaMask from calling eth_estimateGas on its own (potentially
    // lagging) RPC and showing "Unavailable" for the network fee.
    const gasEstimate = await this.publicClient.estimateContractGas({
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
      gas:          gasEstimate * 130n / 100n, // 30 % buffer
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
    const gasEstimate = await this.publicClient.estimateContractGas({
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
      gas:          gasEstimate * 130n / 100n,
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
}

export function createContractClient(config: ContractConfig): PlagueContractClient {
  return new PlagueContractClient(config)
}

// ── Shared wallet helper ──────────────────────────────────────────────────────

function makeWalletClient(account: `0x${string}`, chain: typeof celo | typeof celoSepolia) {
  if (!globalThis.window?.ethereum) {
    throw new Error('No EIP-1193 wallet provider found. Install MetaMask or Valora.')
  }
  return createWalletClient({
    account,
    chain,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: custom(globalThis.window.ethereum as any),
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

  private get publicClient() {
    return createPublicClient({ chain: this.chain, transport: readTransport(this.chain) })
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
 * Read an ERC-20 (cUSD) balance for `account` without needing a full client.
 */
export async function readCUSDBalance(
  account: `0x${string}`,
  cUSDAddress: `0x${string}`,
  network: 'testnet' | 'mainnet',
): Promise<bigint> {
  const chain = CHAINS[network]
  const pc = createPublicClient({ chain, transport: readTransport(chain) })
  return pc.readContract({
    address:      cUSDAddress,
    abi:          ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args:         [account],
  })
}

