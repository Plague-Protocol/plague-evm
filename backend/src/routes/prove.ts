/**
 * POST /api/prove
 *
 * Generates a barretenberg UltraHonk proof using the native `bb` CLI binary.
 *
 * WHY server-side?
 *   @aztec/bb.js (all npm versions through 0.69.1) only contains a
 *   BincodeDeserializer in its WASM.  Nargo ≥ 1.0.0-beta.20 changed the
 *   default ACIR bytecode format to MsgPackCompact, making every npm-based
 *   proof-generation call panic with "unreachable" inside the WASM.
 *   The native `bb` binary installed by Nargo IS compatible with MsgPack,
 *   so we shell out to it here.
 *
 * Request body:
 *   { circuitId: 'role_commitment' | 'innocence_proof' | 'infection_proof',
 *     witnessBase64: string }   ← gzip-compressed witness from @noir-lang/noir_js
 *
 * Response:
 *   { proofHex: string }   ← 0x-prefixed hex of the raw UltraHonk proof bytes
 */
import { Router } from 'express'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { logger } from '../lib/logger'

const execAsync = promisify(exec)

// ── Config ─────────────────────────────────────────────────────────────────

const VALID_CIRCUITS = ['role_commitment', 'innocence_proof', 'infection_proof'] as const
type CircuitId = (typeof VALID_CIRCUITS)[number]

function getBBBinary(): string {
  const bb = process.env.BB_BINARY_PATH
  if (!bb) {
    throw new Error(
      'BB_BINARY_PATH env var is not set. ' +
        'Set it to the path of the `bb` binary installed by Nargo ' +
        '(e.g. BB_BINARY_PATH=/Users/you/.bb/bb).'
    )
  }
  return bb
}

// __dirname works for both ts-node (src/) and compiled (dist/) layouts:
//   backend/src/routes  → ../../../zk/target
//   backend/dist/routes → ../../../zk/target  (same depth)
const CIRCUIT_DIR =
  process.env.ZK_CIRCUIT_DIR || resolve(__dirname, '..', '..', '..', 'zk', 'target')

// ── Validation ─────────────────────────────────────────────────────────────

const ProveRequestSchema = z.object({
  circuitId: z.enum(VALID_CIRCUITS),
  // ~750 KB max in base64 — more than enough for our small circuits
  witnessBase64: z.string().min(1).max(1_000_000),
})

// ── Route ──────────────────────────────────────────────────────────────────

export const proveRouter = Router()

proveRouter.post('/', async (req, res) => {
  const parseResult = ProveRequestSchema.safeParse(req.body)
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid request: ' + parseResult.error.message })
  }

  const { circuitId, witnessBase64 } = parseResult.data
  let tmpDir: string | null = null

  try {
    const bb = getBBBinary()

    // Decode gzip-compressed witness bytes produced by @noir-lang/noir_js
    const witnessBytes = Buffer.from(witnessBase64, 'base64')

    // Isolated temp directory for this proof job
    const tmpId = randomBytes(8).toString('hex')
    tmpDir = join(tmpdir(), `plague-prove-${tmpId}`)
    await mkdir(tmpDir, { recursive: true })

    const witnessPath = join(tmpDir, 'witness.gz')
    await writeFile(witnessPath, witnessBytes)

    // Circuit artifact path (compiled by `nargo compile` into zk/target/)
    const circuitPath = join(CIRCUIT_DIR, `${circuitId}.json`)

    logger.debug({ circuitId, circuitPath, tmpDir }, 'bb prove: starting')

    // -s ultra_honk  → UltraHonk proving scheme (matches deployed verifier contracts)
    // -t evm         → keccak oracle hash (matches --oracle_hash keccak used when
    //                   generating RoleCommitmentVerifier.sol / InnocenceProofVerifier.sol)
    // --write_vk     → compute VK from the circuit inline; avoids needing a pre-existing
    //                   VK file at ./target/vk (the default lookup path bb uses otherwise)
    // -o tmpDir      → bb writes the proof file into this directory as "proof"
    const cmd = `"${bb}" prove -s ultra_honk -t evm --write_vk -b "${circuitPath}" -w "${witnessPath}" -o "${tmpDir}"`
    let bbStdout = ''
    let bbStderr = ''
    try {
      const result = await execAsync(cmd, { timeout: 120_000 })
      bbStdout = result.stdout
      bbStderr = result.stderr
    } catch (execErr) {
      // exec errors carry stdout/stderr on the error object
      const e = execErr as { stdout?: string; stderr?: string; message?: string }
      bbStdout = e.stdout ?? ''
      bbStderr = e.stderr ?? ''
      throw new Error(`bb prove exited with error.\nstdout: ${bbStdout}\nstderr: ${bbStderr}`)
    }
    if (bbStderr) logger.debug({ circuitId, bbStderr }, 'bb prove: stderr')

    // bb writes the proof to <output_dir>/proof when -o is a directory
    const proofPath = join(tmpDir, 'proof')

    const proofBytes = await readFile(proofPath)

    logger.debug({ circuitId, proofSize: proofBytes.length }, 'bb prove: done')

    res.json({ proofHex: '0x' + proofBytes.toString('hex') })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ circuitId: parseResult.data.circuitId, error: msg }, 'bb prove: failed')
    res.status(500).json({ error: 'Proof generation failed', detail: msg })
  } finally {
    if (tmpDir) {
      rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
})
