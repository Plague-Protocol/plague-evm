import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
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
] as const)

export { PLAGUE_GAME_ABI }

// ── Config ────────────────────────────────────────────────────────────────────

const CHAINS = {
  testnet: celoSepolia,  // chainId 11142220
  mainnet: celo,         // chainId 42220
} as const

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
      transport: this.rpcUrl ? http(this.rpcUrl) : http(),
    })
  }

  private walletClient(account: `0x${string}`) {
    return makeWalletClient(account, this.chain)
  }

  private async sendTx(account: `0x${string}`, request: unknown) {
    // Ensure the wallet is on the correct chain before sending
    if (globalThis.window?.ethereum) {
      const chainHex = `0x${this.chain.id.toString(16)}`
      try {
        await globalThis.window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainHex }],
        })
      } catch (switchErr: unknown) {
        // 4902 = chain not added yet — add it then retry
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
    // Use simulateContract to get the returned roomId from the call — avoids
    // the roomCount() race when two rooms are created near-simultaneously.
    const { request, result: roomId } = await this.publicClient.simulateContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'createRoom',
      args:         [maxPlayers, stakeAmount, proofFee, BigInt(expirySecs)],
      account,
    })
    await this.sendTx(account, request)
    return roomId
  }

  /**
   * Join a room and stake the required cUSD amount.
   * Caller must have approved the game contract for at least stakeAmount cUSD beforehand.
   * Use `approveStake` to send the ERC-20 approval transaction first.
   */
  async joinRoom(account: `0x${string}`, roomId: bigint): Promise<void> {
    const { request } = await this.publicClient.simulateContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'joinRoom',
      args:         [roomId],
      account,
    })
    await this.sendTx(account, request)
  }

  /**
   * Approve the game contract to spend `amount` cUSD on behalf of the caller.
   * Must be called before `joinRoom` and before each paid `submitInnocenceProof`.
   */
  async approveCUSD(
    account: `0x${string}`,
    cUSDAddress: `0x${string}`,
    amount: bigint,
  ): Promise<void> {
    const erc20Abi = parseAbi([
      'function approve(address spender, uint256 amount) external returns (bool)',
    ])
    const wc = this.walletClient(account)
    const hash = await wc.writeContract({
      address:      cUSDAddress,
      abi:          erc20Abi,
      functionName: 'approve',
      args:         [this.address, amount],
      account,
    })
    await this.publicClient.waitForTransactionReceipt({ hash })
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

  async getPlayer(roomId: bigint, playerAddress: `0x${string}`) {
    return this.publicClient.readContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'getPlayer',
      args:         [roomId, playerAddress],
    })
  }

  async getRoomCount(): Promise<bigint> {
    return this.publicClient.readContract({
      address:      this.address,
      abi:          PLAGUE_GAME_ABI,
      functionName: 'roomCount',
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
    return createPublicClient({ chain: this.chain, transport: http() })
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
  const pc = createPublicClient({ chain, transport: http() })
  return pc.readContract({
    address:      cUSDAddress,
    abi:          ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args:         [account],
  })
}

