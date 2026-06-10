/**
 * register.ts — Register bot wallets with the ERC-8004 Identity Registry.
 *
 * Run ONCE after mainnet contract deployment:
 *   cd agents && NETWORK=mainnet npm run register
 *
 * Requires:
 *   - NETWORK=mainnet
 *   - BOT_PRIVATE_KEY_1..5 set in .env
 *   - Each bot wallet has CELO on mainnet for gas
 *
 * ERC-8004 Identity Registry on Celo Mainnet:
 *   0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *
 * Output: agents/data/agent-registrations.json
 * Each entry: { botIndex, address, agentId, agentUri }
 */
import { writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseAbi } from 'viem'
import { buildBotWallets, publicClient, NETWORK, FEE_CURRENCY_ADDRESS } from './config.js'

function feeCurrency() {
  return FEE_CURRENCY_ADDRESS ? { feeCurrency: FEE_CURRENCY_ADDRESS } : {}
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = resolve(__dirname, '../data/agent-registrations.json')

// ERC-8004 contracts on Celo Mainnet
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const

const REGISTRY_ABI = parseAbi([
  'function register(string agentURI) external returns (uint256 agentId)',
  'function agentOf(address wallet) external view returns (uint256)',
])

// ── Agent URI builder ─────────────────────────────────────────────────────────

function buildAgentJson(botIndex: number): string {
  return JSON.stringify({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: `Zombie Plague Bot #${botIndex + 1}`,
    description: 'ZK social deduction game agent on Celo. Identifies and eliminates zombies using on-chain commitments.',
    image: 'https://z-plague.vercel.app/images/z-plague-image.png',
    services: [{ name: 'game', endpoint: 'https://z-plague.vercel.app/' }],
    source: 'https://github.com/Plague-Protocol/plague-evm',
  })
}

function toDataUri(json: string): string {
  const b64 = Buffer.from(json).toString('base64')
  return `data:application/json;base64,${b64}`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (NETWORK !== 'mainnet') {
    console.error('ERC-8004 Identity Registry only exists on Celo Mainnet.')
    console.error('Set NETWORK=mainnet in your .env and try again.')
    process.exit(1)
  }

  const bots = buildBotWallets()
  console.log(`\nRegistering ${bots.length} bot(s) with ERC-8004 Identity Registry`)
  console.log(`Registry: ${IDENTITY_REGISTRY}`)
  console.log(`Network: mainnet\n`)

  const results: Array<{
    botIndex: number
    address: string
    agentId: string
    agentUri: string
  }> = []

  for (const bot of bots) {
    console.log(`── Bot #${bot.index + 1}: ${bot.address}`)

    // Check if already registered
    try {
      const existingId = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'agentOf',
        args: [bot.address],
      })
      if (existingId > 0n) {
        console.log(`   Already registered — agentId: ${existingId}`)
        const agentUri = toDataUri(buildAgentJson(bot.index))
        results.push({
          botIndex: bot.index,
          address: bot.address,
          agentId: existingId.toString(),
          agentUri,
        })
        continue
      }
    } catch {
      // Registry may not have agentOf — proceed with registration
    }

    const agentJson = buildAgentJson(bot.index)
    const agentUri = toDataUri(agentJson)

    console.log(`   Agent URI: data:application/json;base64,...(${agentUri.length} chars)`)
    console.log('   Submitting registration tx...')

    try {
      // Simulate — forno's eth_estimateGas reverts on this contract even though
      // eth_call succeeds, so we use the simulation's prepared request directly
      // to bypass re-estimation inside writeContract.
      const { result: agentId, request } = await publicClient.simulateContract({
        account: bot.account,
        address: IDENTITY_REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'register',
        args: [agentUri],
        ...feeCurrency(),
      })

      const hash = await bot.walletClient.writeContract({
        ...request,
        chain: publicClient.chain,
        gas: request.gas ?? 800_000n,
      })

      await publicClient.waitForTransactionReceipt({ hash })
      console.log(`   Registered ✓ — agentId: ${agentId} (tx: ${hash})`)

      results.push({
        botIndex: bot.index,
        address: bot.address,
        agentId: agentId.toString(),
        agentUri,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`   Registration failed: ${msg}`)
    }
  }

  await mkdir(resolve(__dirname, '../data'), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2))

  console.log(`\n✓ Saved registration data to ${OUTPUT_PATH}`)
  console.log('\nRegistered agents:')
  for (const r of results) {
    console.log(`  Bot ${r.botIndex + 1} (${r.address}): agentId=${r.agentId}`)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
