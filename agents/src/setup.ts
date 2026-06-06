/**
 * setup.ts — One-time setup: generate ZK commitments + proofs for each bot.
 *
 * Run ONCE before the first game cycle:
 *   cd agents && npm run setup
 *
 * Requires:
 *   - .env with BACKEND_URL, BOT_PRIVATE_KEY_1..5
 *   - Backend running and reachable at BACKEND_URL (for /api/prove)
 *   - zk/target/role_commitment.json circuit artifact (nargo compile)
 *
 * Output: agents/data/bot-proofs.json
 * Each entry: { index, address, commitment, proofHex }
 */
import { randomBytes } from 'crypto'
import { writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { buildBotWallets, BACKEND_URL } from './config.js'
import { computeCommitment, generateRoleWitness, getProofFromBackend, BN254_R, toField } from './zk.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = resolve(__dirname, '../data/bot-proofs.json')

export interface BotProof {
  index: number
  address: string
  commitment: `0x${string}`
  proofHex: `0x${string}`
}

async function main(): Promise<void> {
  const bots = buildBotWallets()
  console.log(`\nGenerating ZK proofs for ${bots.length} bot(s)...`)
  console.log(`Backend: ${BACKEND_URL}`)
  console.log(`Output:  ${OUTPUT_PATH}\n`)

  const results: BotProof[] = []

  for (const bot of bots) {
    console.log(`── Bot #${bot.index + 1}: ${bot.address}`)

    // Random secret in BN254 field
    const secretBytes = randomBytes(31) // 248 bits — always < BN254 field
    const secret = BigInt('0x' + secretBytes.toString('hex')) % BN254_R

    // All bots commit as "clean" (role = 0).
    // Infection is assigned by the backend after the game starts.
    const ROLE_CLEAN = 0n
    console.log('   Computing commitment (poseidon2)...')
    const commitment = await computeCommitment(ROLE_CLEAN, secret)
    const commitmentHex = toField(commitment) as `0x${string}`
    console.log(`   Commitment: ${commitmentHex.slice(0, 22)}...`)

    console.log('   Generating witness (@noir-lang/noir_js)...')
    const witness = await generateRoleWitness(ROLE_CLEAN, secret, commitment)
    console.log(`   Witness: ${witness.length} bytes`)

    console.log('   Generating proof via /api/prove (may take 30-120s)...')
    const t0 = Date.now()
    const proofHex = await getProofFromBackend(witness, BACKEND_URL)
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`   Proof: ${proofHex.slice(0, 22)}... (${elapsed}s)`)

    results.push({ index: bot.index, address: bot.address, commitment: commitmentHex, proofHex })
    console.log(`   Done ✓\n`)
  }

  await mkdir(resolve(__dirname, '../data'), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2))

  console.log(`\n✓ Saved ${results.length} bot proof(s) to ${OUTPUT_PATH}`)
  console.log('  These will be reused every game cycle.')
  console.log('  Re-run `npm run setup` only if you change bot wallets.\n')

  // Also print a summary for easy verification
  console.log('Bot addresses (share these for ERC-8004 registration):')
  for (const r of results) {
    console.log(`  Bot ${r.index + 1}: ${r.address}`)
  }
}

main().catch(err => {
  console.error('\n✗ Setup failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
