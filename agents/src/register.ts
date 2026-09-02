/**
 * register.ts — Register bot wallets with the ERC-8004 Identity Registry.
 *
 * Safe to re-run: wallets that already hold an identity are skipped, so adding
 * keys 6..8 to a pool where 1..5 are registered mints only the three missing
 * ones.
 *
 *   cd agents && NETWORK=mainnet npm run register
 *
 * Requires:
 *   - NETWORK=mainnet
 *   - BOT_PRIVATE_KEY_1..N set in .env
 *   - Each bot wallet has CELO on mainnet for gas
 *
 * ERC-8004 Identity Registry on Celo Mainnet:
 *   0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *
 * Output: agents/data/agent-registrations.json
 * Each entry: { botIndex, address, agentId, agentUri }
 *
 * That file is the ONLY record of which id belongs to which wallet — the
 * registry cannot be asked (see the ABI note below), and `register()` returns
 * an id exactly once. Do not delete it.
 */
import { writeFile, readFile, mkdir } from 'fs/promises'
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
  // The registry is an ERC-721 but NOT enumerable, and exposes NO address →
  // agentId getter: agentOf, agentIdOf and tokenOfOwnerByIndex all revert on
  // mainnet (verified against 0x8004…a432). balanceOf is the only on-chain
  // answer to "does this wallet already hold an identity" — which is the one
  // question the duplicate-mint guard actually needs. The id comes back once,
  // from register(), and lives in agent-registrations.json from then on.
  'function balanceOf(address owner) external view returns (uint256)',
])

interface Registration {
  botIndex: number
  address: string
  agentId: string
  agentUri: string
}

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

/** Previously recorded registrations, keyed by lowercased address. */
async function loadPrior(): Promise<Map<string, Registration>> {
  try {
    const raw = await readFile(OUTPUT_PATH, 'utf8')
    const rows = JSON.parse(raw) as Registration[]
    return new Map(rows.map(r => [r.address.toLowerCase(), r]))
  } catch {
    return new Map() // first run
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (NETWORK !== 'mainnet') {
    console.error('ERC-8004 Identity Registry only exists on Celo Mainnet.')
    console.error('Set NETWORK=mainnet in your .env and try again.')
    process.exit(1)
  }

  const bots = buildBotWallets()
  const prior = await loadPrior()

  console.log(`\nRegistering ${bots.length} bot(s) with ERC-8004 Identity Registry`)
  console.log(`Registry: ${IDENTITY_REGISTRY}`)
  console.log(`Network: mainnet`)
  console.log(`Known from a previous run: ${prior.size}\n`)

  const results: Registration[] = []
  let minted = 0
  let skipped = 0
  let failed = 0

  for (const bot of bots) {
    console.log(`── Bot #${bot.index + 1}: ${bot.address}`)
    const known = prior.get(bot.address.toLowerCase())

    let held: bigint
    try {
      held = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'balanceOf',
        args: [bot.address],
      })
    } catch (err) {
      // A read that FAILED is not evidence of "not registered". Swallowing this
      // and minting anyway is precisely how a wallet ends up holding two
      // identities, so refuse to act on an unanswered question.
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`   Identity check failed — skipping so we cannot double-mint: ${msg}`)
      if (known) results.push(known)
      failed++
      continue
    }

    if (held > 0n) {
      if (known) {
        console.log(`   Already registered — agentId: ${known.agentId}`)
        results.push(known)
      } else {
        // Holds an identity we have no record of. The id is unrecoverable from
        // the chain, so preserve the fact and leave the id to a human.
        console.log(`   Already registered, but its agentId is not in ${OUTPUT_PATH}.`)
        console.log(`   Recording agentId "unknown" — recover it from the mint tx and edit by hand.`)
        results.push({
          botIndex: bot.index,
          address: bot.address,
          agentId: 'unknown',
          agentUri: toDataUri(buildAgentJson(bot.index)),
        })
      }
      skipped++
      continue
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
      minted++

      results.push({
        botIndex: bot.index,
        address: bot.address,
        agentId: agentId.toString(),
        agentUri,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`   Registration failed: ${msg}`)
      failed++
    }
  }

  // Carry forward any prior entry whose key is no longer in .env, so rotating a
  // key out of the pool does not erase the record of the identity it minted.
  const seen = new Set(results.map(r => r.address.toLowerCase()))
  for (const [addr, row] of prior) {
    if (!seen.has(addr)) {
      console.log(`\nKeeping record for ${row.address} (agentId ${row.agentId}) — no matching key in .env`)
      results.push(row)
    }
  }
  results.sort((a, b) => a.botIndex - b.botIndex)

  await mkdir(resolve(__dirname, '../data'), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2))

  console.log(`\n✓ Saved registration data to ${OUTPUT_PATH}`)
  console.log(`  minted ${minted} · already registered ${skipped} · failed ${failed}`)
  console.log('\nRegistered agents:')
  for (const r of results) {
    console.log(`  Bot ${r.botIndex + 1} (${r.address}): agentId=${r.agentId}`)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
